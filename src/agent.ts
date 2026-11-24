import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, StateSchema, MessagesValue, START, MemorySaver } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { weatherTool } from './weather.ts';

const SYSTEM_PROMPT = 'Eres un asistente útil y conciso. Usa la herramienta get_weather cuando pregunten por el clima.';
const tools = [weatherTool];

// LLM_PROVIDER=nvidia uses NVIDIA's OpenAI-compatible endpoint; anything else uses Groq.
function createModel() {
  if (process.env.LLM_PROVIDER === 'nvidia') {
    if (!process.env.NVIDIA_API_KEY) throw new Error('Falta NVIDIA_API_KEY en .env');
    return new ChatOpenAI({
      model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      apiKey: process.env.NVIDIA_API_KEY,
      configuration: { baseURL: 'https://integrate.api.nvidia.com/v1' },
    }).bindTools(tools);
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY en .env');
  return new ChatGroq({ model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b', temperature: 0 }).bindTools(tools);
}
const model = createModel();

const State = new StateSchema({ messages: MessagesValue });

// llm -> (tool call?) -> tools -> llm ... -> END
const graph = new StateGraph(State)
  .addNode('llm', async (state) => ({
    messages: [await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages])],
  }))
  .addNode('tools', new ToolNode(tools)) // tool errors go back to the model as messages, not exceptions
  .addEdge(START, 'llm')
  .addConditionalEdges('llm', toolsCondition, ['tools', '__end__'])
  .addEdge('tools', 'llm')
  // shortcut: MemorySaver keeps every thread in RAM, lost on restart and never trimmed; use a persistent checkpointer (e.g. SQLite/Postgres) beyond local dev.
  .compile({ checkpointer: new MemorySaver() });

export type Usage = { inputTokens: number; outputTokens: number };

// Same threadId = same conversation: the checkpointer restores previous messages before this one is added.
export async function runAgent(userMessage: string, threadId: string): Promise<{ reply: string; usage: Usage }> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    // recursionLimit stops a model that keeps calling tools forever (~5 llm/tool round trips per message).
    { recursionLimit: 10, configurable: { thread_id: threadId } },
  );

  // Only this turn's model calls (after the last user message); each call's input already includes the history.
  const turn = result.messages.slice(result.messages.findLastIndex((m) => HumanMessage.isInstance(m)) + 1);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const m of turn) {
    if (!AIMessage.isInstance(m)) continue;
    usage.inputTokens += m.usage_metadata?.input_tokens ?? 0;
    usage.outputTokens += m.usage_metadata?.output_tokens ?? 0;
  }
  return { reply: result.messages.at(-1)?.text ?? '', usage };
}
