export interface LosslessJsonNumber {
  readonly kind: "lossless-json-number";
  readonly lexeme: string;
}

export type LosslessJsonValue =
  | boolean
  | null
  | string
  | LosslessJsonNumber
  | readonly LosslessJsonValue[]
  | { readonly [key: string]: LosslessJsonValue };

export class LosslessJsonParseError extends SyntaxError {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = "LosslessJsonParseError";
    this.offset = offset;
  }
}

export function isLosslessJsonNumber(value: unknown): value is LosslessJsonNumber {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "lossless-json-number"
    && typeof (value as { lexeme?: unknown }).lexeme === "string";
}

class Parser {
  private offset = 0;
  private depth = 0;

  constructor(
    private readonly source: string,
    private readonly maxDepth: number,
  ) {}

  parse(): LosslessJsonValue {
    this.whitespace();
    const value = this.value();
    this.whitespace();
    if (this.offset !== this.source.length) this.fail("Unexpected trailing data");
    return value;
  }

  private value(): LosslessJsonValue {
    this.whitespace();
    const character = this.source[this.offset];
    if (character === '"') return this.string();
    if (character === "{") return this.object();
    if (character === "[") return this.array();
    if (character === "t") return this.literal("true", true);
    if (character === "f") return this.literal("false", false);
    if (character === "n") return this.literal("null", null);
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) return this.number();
    this.fail("Expected a JSON value");
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.fail(`Maximum JSON depth of ${this.maxDepth} exceeded`);
  }

  private leave(): void {
    this.depth -= 1;
  }

  private object(): LosslessJsonValue {
    this.enter();
    this.offset += 1;
    this.whitespace();
    const result: Record<string, LosslessJsonValue> = Object.create(null) as Record<string, LosslessJsonValue>;
    const keys = new Set<string>();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      this.leave();
      return Object.freeze(result);
    }
    while (true) {
      if (this.source[this.offset] !== '"') this.fail("Expected an object key");
      const key = this.string();
      if (keys.has(key)) this.fail(`Duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.whitespace();
      if (this.source[this.offset] !== ":") this.fail("Expected ':' after object key");
      this.offset += 1;
      result[key] = this.value();
      this.whitespace();
      const separator = this.source[this.offset];
      if (separator === "}") {
        this.offset += 1;
        this.leave();
        return Object.freeze(result);
      }
      if (separator !== ",") this.fail("Expected ',' or '}' in object");
      this.offset += 1;
      this.whitespace();
    }
  }

  private array(): LosslessJsonValue {
    this.enter();
    this.offset += 1;
    this.whitespace();
    const result: LosslessJsonValue[] = [];
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      this.leave();
      return Object.freeze(result);
    }
    while (true) {
      result.push(this.value());
      this.whitespace();
      const separator = this.source[this.offset];
      if (separator === "]") {
        this.offset += 1;
        this.leave();
        return Object.freeze(result);
      }
      if (separator !== ",") this.fail("Expected ',' or ']' in array");
      this.offset += 1;
      this.whitespace();
    }
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset]!;
      if (character === '"') {
        this.offset += 1;
        const token = this.source.slice(start, this.offset);
        try {
          return JSON.parse(token) as string;
        } catch {
          this.fail("Invalid JSON string escape");
        }
      }
      if (character === "\\") {
        this.offset += 2;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) this.fail("Unescaped control character in string");
      this.offset += 1;
    }
    this.fail("Unterminated JSON string");
  }

  private number(): LosslessJsonNumber {
    const remainder = this.source.slice(this.offset);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remainder);
    if (!match) this.fail("Invalid JSON number");
    const lexeme = match[0]!;
    this.offset += lexeme.length;
    return Object.freeze({ kind: "lossless-json-number", lexeme });
  }

  private literal<T extends boolean | null>(token: string, value: T): T {
    if (!this.source.startsWith(token, this.offset)) this.fail(`Expected ${token}`);
    this.offset += token.length;
    return value;
  }

  private whitespace(): void {
    while (true) {
      const character = this.source[this.offset];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") return;
      this.offset += 1;
    }
  }

  private fail(message: string): never {
    throw new LosslessJsonParseError(message, this.offset);
  }
}

export interface LosslessJsonOptions {
  readonly maxDepth?: number;
}

export function parseLosslessJson(source: string, options: LosslessJsonOptions = {}): LosslessJsonValue {
  const maxDepth = options.maxDepth ?? 64;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 1_024) {
    throw new RangeError("maxDepth must be an integer from 1 through 1024");
  }
  return new Parser(source, maxDepth).parse();
}
