export default async function* nodeReporter(events) {
  for await (const event of events) {
    if (["test:enqueue", "test:pass", "test:fail", "test:summary"].includes(event.type)) yield `${JSON.stringify(event)}\n`;
  }
}
