import { readFileSync } from 'node:fs';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';

// Plantilla = prompt de sistema (prompts/<file>, formato mustache) + la conversación.
// `variables` son las que el código envía. Si el archivo usa otra (p. ej. un typo como
// {{fehca}}), fallamos al arrancar: mustache la dejaría vacía sin avisar.
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
