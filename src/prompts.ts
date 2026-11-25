// ============================================================================
// prompts.ts — Carga los prompts desde la carpeta /prompts.
//
// ¿Por qué en archivos aparte y no dentro del código?
//   - Se leen y editan como texto normal (Markdown), sin tocar TypeScript.
//   - Cada cambio queda en git, así que se puede revisar y volver atrás.
//   - Quien escribe el prompt no necesita entender el resto del código.
//
// Los prompts son PLANTILLAS: {{variable}} se reemplaza por un valor al usarlas
// (formato "mustache", parecido a Jinja en Python). Ejemplo:
//   "Hoy es {{today}}."  +  { today: 'martes' }  →  "Hoy es martes."
// ============================================================================

import { readFileSync } from 'node:fs';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';

// Crea una plantilla de chat con:
//   1. El prompt de sistema, leído de prompts/<file>.
//   2. Un hueco llamado "messages" donde va la conversación.
// `variables` es la lista de variables que el código va a enviar. Si el archivo usa
// otra (por ejemplo, un error de tipeo como {{fehca}}), el servidor no arranca:
// mustache la dejaría vacía sin avisar y el error pasaría desapercibido.
export function loadChatPrompt(file: string, variables: string[]) {
  const text = readFileSync(new URL(`../prompts/${file}`, import.meta.url), 'utf8');
  const prompt = ChatPromptTemplate.fromMessages(
    [['system', text], new MessagesPlaceholder('messages')],
    { templateFormat: 'mustache' },
  );

  const unknown = prompt.inputVariables.filter((v) => v !== 'messages' && !variables.includes(v));
  if (unknown.length) {
    throw new Error(`prompts/${file} usa variables que el código no envía: ${unknown.join(', ')}`);
  }
  return prompt;
}
