// Reads a WoW SavedVariables file: plain Lua assignments of strings, numbers,
// booleans and nested tables, as the game writes them on logout or /reload.
// Returns each global by name. Tables keyed 1..n become arrays, others objects.

export type LuaValue = string | number | boolean | LuaValue[] | { [key: string]: LuaValue };

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "\n": "\n",
};

export function parseSavedVariables(src: string): Record<string, LuaValue> {
  let i = 0;

  const fail = (message: string): never => {
    throw new Error(`${message} at character ${i}: ${JSON.stringify(src.slice(i, i + 30))}`);
  };

  const skipSpaceAndComments = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (!src.startsWith("--", i)) return;
      const block = src.startsWith("--[[", i);
      const end = block ? src.indexOf("]]", i + 4) : src.indexOf("\n", i);
      i = end < 0 ? src.length : end + (block ? 2 : 1);
    }
  };

  const expect = (char: string) => {
    skipSpaceAndComments();
    if (src[i] !== char) fail(`Expected '${char}'`);
    i++;
  };

  const name = (): string => {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (!match) return fail("Expected a name");
    i += match[0].length;
    return match[0];
  };

  // \ddd escapes are bytes, so the string is rebuilt as UTF-8 bytes and decoded once.
  const string = (): string => {
    const quote = src[i++];
    const bytes: number[] = [];
    const push = (text: string) => bytes.push(...Buffer.from(text, "utf8"));
    while (i < src.length) {
      const char = src[i++]!;
      if (char === quote) return Buffer.from(bytes).toString("utf8");
      if (char !== "\\") {
        // Read the whole code point, so emoji and other surrogate pairs stay intact.
        const code = src.codePointAt(i - 1)!;
        if (code > 0xffff) i++;
        push(String.fromCodePoint(code));
        continue;
      }
      const escape = src[i++] ?? "";
      if (escape in ESCAPES) {
        push(ESCAPES[escape]!);
      } else if (/\d/.test(escape)) {
        let digits = escape;
        while (digits.length < 3 && /\d/.test(src[i] ?? "")) digits += src[i++];
        bytes.push(Number(digits) & 0xff);
      } else {
        push(escape);
      }
    }
    return fail("Unterminated string");
  };

  const number = (): number => {
    const match = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
    if (!match) return fail("Expected a number");
    i += match[0].length;
    return Number(match[0]);
  };

  const table = (): LuaValue => {
    i++; // {
    const entries: Array<[string | number, LuaValue]> = [];
    let nextIndex = 1;
    for (;;) {
      skipSpaceAndComments();
      if (src[i] === "}") {
        i++;
        break;
      }
      let key: string | number;
      if (src[i] === "[") {
        i++;
        const raw = value();
        if (typeof raw !== "string" && typeof raw !== "number") return fail("Expected a string or number key");
        key = raw as string | number;
        expect("]");
        expect("=");
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.test(src.slice(i, i + 300)) &&
        !/^(true|false|nil)\b/.test(src.slice(i, i + 6))
      ) {
        key = name();
        expect("=");
      } else {
        key = nextIndex++;
      }
      const item = value();
      if (item !== undefined) entries.push([key, item]);
      skipSpaceAndComments();
      if (src[i] === "," || src[i] === ";") i++;
    }
    if (entries.every(([key], index) => key === index + 1)) return entries.map(([, item]) => item);
    return Object.fromEntries(entries.map(([key, item]) => [String(key), item]));
  };

  // undefined = nil
  function value(): LuaValue | undefined {
    skipSpaceAndComments();
    const char = src[i];
    if (char === '"' || char === "'") return string();
    if (char === "{") return table();
    if (char === "-" || char === "." || /\d/.test(char ?? "")) return number();
    const word = name();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "nil") return undefined;
    return fail(`Unexpected '${word}'`);
  }

  const globals: Record<string, LuaValue> = {};
  for (;;) {
    skipSpaceAndComments();
    if (i >= src.length) return globals;
    const global = name();
    expect("=");
    const assigned = value();
    if (assigned !== undefined) globals[global] = assigned;
  }
}
