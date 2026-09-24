/**
 * Structured logs for every Worker: one JSON object per line, which Workers
 * Logs indexes by field. Base fields ride on every line (the ingest Worker's
 * runId and slot, the API's route), so one run or request can be pulled out
 * of the stream.
 */

export type Level = 'info' | 'warn' | 'error';
export type Fields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  /** A logger whose lines also carry `fields`. */
  child(fields: Fields): Logger;
}

export type Sink = (line: string) => void;

// The console is the Workers log transport.
const consoleSink: Sink = (line) => console.log(line);

export function createLogger(base: Fields = {}, sink: Sink = consoleSink): Logger {
  const write = (level: Level, event: string, fields: Fields = {}): void => {
    sink(JSON.stringify({ level, event, ts: new Date().toISOString(), ...base, ...fields }));
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

/** An Error as loggable fields; anything else as its string form. */
export function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    return { error: error.message, errorName: error.name, stack: error.stack?.slice(0, 2000) };
  }
  return { error: String(error) };
}
