import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, StateSchema, MessagesValue, START, MemorySaver } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { weatherTool } from './weather.ts';
import { log, msSince } from './log.ts';

const SYSTEM_PROMPT = 'Eres un asistente útil y conciso. Usa la herramienta get_weather cuando pregunten por el clima.';
const tools = [weatherTool];
const model = chatModel.bindTools(tools);

const State = new StateSchema({ messages: MessagesValue });

// llm -> (tool call?) -> tools -> llm ... -> END
const graph = new StateGraph(State)
  .addNode('llm', async (state) => {
    const start = performance.now();
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    const toolCalls = response.tool_calls?.map((t) => t.name).join(',') || 'none';
    log('INFO', 'llm', { ms: msSince(start), toolCalls, ...sumUsage([response]) });
    return { messages: [response] };
  })
  .addNode('tools', new ToolNode(tools)) // tool errors go back to the model as messages, not exceptions
  .addEdge(START, 'llm')
  .addConditionalEdges('llm', toolsCondition, ['tools', '__end__'])
  .addEdge('tools', 'llm')
  // shortcut: MemorySaver keeps every thread in RAM, lost on restart and never trimmed; use a persistent checkpointer (e.g. SQLite/Postgres) beyond local dev.
  .compile({ checkpointer: new MemorySaver() });

// Same threadId = same conversation: the checkpointer restores previous messages before this one is added.
export async function runAgent(userMessage: string, threadId: string): Promise<{ reply: string; usage: Usage }> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    // recursionLimit stops a model that keeps calling tools forever (~5 llm/tool round trips per message).
    { recursionLimit: 10, configurable: { thread_id: threadId } },
  );

  // Only this turn's model calls (after the last user message); each call's input already includes the history.
  const turn = result.messages.slice(result.messages.findLastIndex((m) => HumanMessage.isInstance(m)) + 1);
  const usage = sumUsage(turn);
  // historyMessages grows with each turn of the same thread: that's the memory at work.
  log('INFO', 'agent done', { threadId, historyMessages: result.messages.length, ...usage });
  return { reply: result.messages.at(-1)?.text ?? '', usage };
}
