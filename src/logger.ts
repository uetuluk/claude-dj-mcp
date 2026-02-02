const PREFIX = "[Claude-DJ]";

export const log = {
  info: (...args: unknown[]) => {
    console.error(PREFIX, ...args);
  },
  error: (...args: unknown[]) => {
    console.error(PREFIX, "ERROR:", ...args);
  },
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG === "true") {
      console.error(PREFIX, "DEBUG:", ...args);
    }
  },
};
