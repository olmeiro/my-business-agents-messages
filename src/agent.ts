// ============================================================================
// agent.ts — El agente, construido como un GRAFO de LangGraph.
//
// Un grafo es un diagrama de pasos:
//   - Los NODOS son los pasos (funciones que hacen algo).
//   - Las ARISTAS (edges) dicen qué paso va después de cuál.
//   - El ESTADO es la información que viaja de un nodo a otro (aquí, los mensajes).
//
// Nuestro grafo tiene solo 2 nodos:
//
//   START ──► [llm] ──¿el modelo pidió una herramienta?── no ──► END
//               ▲            │ sí
//               │            ▼
//               └──────── [tools]   (ejecuta get_weather y vuelve al modelo)
// ============================================================================

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, StateSchema, MessagesValue, START, MemorySaver } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { weatherTool } from './weather.ts';
import { log, msSince } from './log.ts';

// Instrucciones fijas que el modelo recibe siempre, antes de la conversación.
const SYSTEM_PROMPT = 'Eres un asistente útil y conciso. Usa la herramienta get_weather cuando pregunten por el clima.';

// Lista de herramientas que el agente puede usar. Para agregar otra, basta con sumarla aquí.
const tools = [weatherTool];

// bindTools le "enseña" al modelo qué herramientas existen (nombre, descripción y parámetros).
// El modelo NO las ejecuta: solo responde "quiero usar get_weather con city=Bogotá".
const model = chatModel.bindTools(tools);

// El estado del grafo: una lista de mensajes (usuario, modelo, herramientas).
// MessagesValue hace que cada nodo AGREGUE mensajes a la lista en vez de reemplazarla.
const State = new StateSchema({ messages: MessagesValue });

const graph = new StateGraph(State)
  // Nodo 1, "llm": le manda al modelo todo el historial y guarda su respuesta.
  .addNode('llm', async (state) => {
    const start = performance.now();
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    const toolCalls = response.tool_calls?.map((t) => t.name).join(',') || 'none';
    log('INFO', 'llm', { ms: msSince(start), toolCalls, ...sumUsage([response]) });
    return { messages: [response] };
  })
  // Nodo 2, "tools": ejecuta las herramientas que el modelo pidió.
  // ToolNode viene hecho por LangGraph. Si una herramienta falla, no rompe la petición:
  // le pasa el error al modelo como un mensaje para que responda algo razonable.
  .addNode('tools', new ToolNode(tools))
  // Siempre se empieza por el modelo.
  .addEdge(START, 'llm')
  // Después del modelo hay una decisión: toolsCondition mira si pidió una herramienta.
  // Si la pidió, va a "tools"; si no, termina ('__end__').
  .addConditionalEdges('llm', toolsCondition, ['tools', '__end__'])
  // Después de ejecutar la herramienta, se vuelve al modelo con el resultado.
  .addEdge('tools', 'llm')
  // compile() convierte la definición en un grafo ejecutable.
  // El checkpointer (MemorySaver) guarda los mensajes de cada conversación: esa es la memoria.
  // shortcut: (atajo) MemorySaver guarda todo en la RAM, así que se pierde al reiniciar y nunca se borra.
  // Fuera de un entorno local, usa un checkpointer persistente (por ejemplo SQLite o Postgres).
  .compile({ checkpointer: new MemorySaver() });

// Ejecuta el agente con un mensaje del usuario.
// Mismo threadId = misma conversación: LangGraph recupera los mensajes anteriores de ese hilo
// y les agrega el nuevo antes de llamar al modelo.
export async function runAgent(userMessage: string, threadId: string): Promise<{ reply: string; usage: Usage }> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    {
      // Freno de seguridad: corta si el modelo se queda pidiendo herramientas en bucle
      // (10 pasos ≈ 5 idas y vueltas modelo → herramienta por mensaje).
      recursionLimit: 10,
      configurable: { thread_id: threadId },
    },
  );

  // result.messages trae TODO el historial. Para contar los tokens de este mensaje,
  // nos quedamos solo con lo que vino después del último mensaje del usuario.
  // (Ojo: la entrada de cada llamada ya incluye el historial, por eso crece con la conversación).
  const turn = result.messages.slice(result.messages.findLastIndex((m) => HumanMessage.isInstance(m)) + 1);
  const usage = sumUsage(turn);
  // historyMessages crece con cada mensaje del mismo threadId: así se ve la memoria funcionando.
  log('INFO', 'agent done', { threadId, historyMessages: result.messages.length, ...usage });
  // La respuesta final es el último mensaje del historial.
  return { reply: result.messages.at(-1)?.text ?? '', usage };
}
