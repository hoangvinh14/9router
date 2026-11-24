// The final usage chunk precedes [DONE] when include_usage is requested.
// Hold its bytes until the storage ACK so the client cannot see a false completion.
export function createAccountedOpenAIChatStream(attempt, onTerminal, includeUsage) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '', id, usageSeen = false, finished = false;
  return new TransformStream({
    async transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      let delimiter;
      while ((delimiter = /\r?\n\r?\n/.exec(buffer))) {
        const raw = buffer.slice(0, delimiter.index);
        if (raw.length > 1024 * 1024) throw new Error('Chat SSE frame too large');
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        const data = raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          if (!finished || buffer.trim()) throw new Error('Invalid Chat SSE terminal');
          if (!usageSeen) await attempt.settleJson(undefined);
          onTerminal();
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.terminate();
          return;
        }
        const chunk = JSON.parse(data);
        if (usageSeen || chunk?.object !== 'chat.completion.chunk' || !chunk.id ||
            (id && chunk.id !== id) || !Array.isArray(chunk.choices)) throw new Error('Invalid Chat SSE chunk');
        id = chunk.id;
        if (!chunk.choices.length) {
          if (!finished || !chunk.usage) throw new Error('Invalid Chat SSE usage trailer');
          await attempt.settleJson(chunk.usage);
          usageSeen = true;
          if (!includeUsage) continue;
        } else {
          if (finished || chunk.choices.length !== 1 || chunk.choices[0]?.index !== 0 || chunk.usage != null) {
            throw new Error('Invalid Chat SSE choice');
          }
          finished = chunk.choices[0].finish_reason != null;
        }
        if (!includeUsage) delete chunk.usage;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      if (buffer.length > 1024 * 1024) throw new Error('Chat SSE frame too large');
    },
    flush() { throw new Error('Incomplete Chat SSE response'); },
  });
}
