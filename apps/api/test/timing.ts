/** Median duration in ms of `run`, over a few runs to smooth out noise. */
export async function medianMs(
  run: () => Promise<unknown>,
  times = 5,
): Promise<number> {
  const durations: number[] = [];
  for (let index = 0; index < times; index += 1) {
    const start = process.hrtime.bigint();
    await run();
    durations.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return durations.sort((a, b) => a - b)[Math.floor(times / 2)];
}
