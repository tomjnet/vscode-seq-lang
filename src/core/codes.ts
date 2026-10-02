// Stable facts about the Seq language and seqc, taken from seq-lang
// docs/language.md (grammar version 1, seqc 0.1).

export const LANGUAGE_DOC_URL = 'https://github.com/tomjnet/seq-lang/blob/main/docs/language.md';
export const DIAGNOSTICS_DOC_URL = `${LANGUAGE_DOC_URL}#diagnostics`;
export const INSTALL_URL = 'https://tomjnet.github.io/seq-lang/learn/#install';
export const REFERENCE_MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct';

export const RESERVED_WORDS = ['model', 'backend', 'name', 'step', 'ask'] as const;

export const LIMITS = {
  steps: 64,
  asksPerStep: 16,
  requestBytes: 4096,
  nameLength: 64,
} as const;

export const ERROR_CODES: Readonly<Record<string, string>> = {
  E0101: 'The file is not valid UTF-8.',
  E0102: 'NUL byte or control character.',
  E0103: 'Tab character.',
  E0104: 'Carriage return without a line feed.',
  E0105: 'Unterminated string literal.',
  E0106: 'Unknown escape sequence.',
  E0107: 'Unexpected character.',
  E0108: 'Indentation is not 0 or 4 spaces.',
  E0109: 'The file is larger than 1 MiB.',
  E0110: 'The file cannot be read.',
  E0201: 'Unexpected token or unknown declaration.',
  E0202: '`model` written as an assignment.',
  E0203: '`backend` written as an assignment.',
  E0204: '`ask` without parentheses.',
  E0205: 'Header declaration after the first step.',
  E0206: '`ask()` outside a step.',
  E0207: 'Indented line that does not belong to a step.',
  E0208: 'Reserved word used as a step name.',
  E0209: 'Step with no `ask()` statements.',
  E0211: 'Step with parameters.',
  E0212: 'Statement other than `ask()` inside a step.',
  E0213: '`ask()` with no argument, more than one, or one that is not a string.',
  E0301: 'Missing `model` declaration.',
  E0302: 'Missing `backend` declaration.',
  E0303: 'Missing `name` declaration.',
  E0304: 'Duplicate header declaration.',
  E0305: '`backend.Rust()` is reserved and not supported in v0.1.',
  E0306: 'Unknown backend.',
  E0307: '`model()` with no argument or more than two.',
  E0308: '`model()` argument that is not a string.',
  E0309: 'Empty `model()` argument.',
  E0310: 'The reserved model server argument, not supported in v0.1.',
  E0311: 'The model is not a `https://huggingface.co/<owner>/<repo>` URL.',
  E0312: 'Invalid project name.',
  E0313: 'Project name longer than 64 characters.',
  E0314: 'Workflow with no steps.',
  E0315: 'Duplicate step name.',
  E0316: 'Empty request.',
  E0317: 'Request longer than 4096 bytes.',
  E0318: 'More than 64 steps.',
  E0319: 'More than 16 `ask()` statements in a step.',
  E0320: '`backend.C()` with arguments.',
};

export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  source: 3,
  model: 4,
  compile: 5,
  execution: 6,
  filesystem: 7,
  prerequisite: 8,
  cancelled: 130,
} as const;

export const KEYWORD_DOCS: Readonly<Record<string, string>> = {
  model:
    '**model**`("<url>")`,which model writes the program.\n\n' +
    'A call with exactly one nonempty string of the form `https://huggingface.co/<owner>/<repo>`, ' +
    'optionally followed by `/tree/<revision>`. Required exactly once, before the first step.',
  backend:
    '**backend**`.C()`,the language of the generated program.\n\n' +
    '`C` is the only backend in v0.1 and takes no arguments. `backend.Rust()` is reserved. ' +
    'Required exactly once, before the first step.',
  name:
    '**name**` = "<name>"`,the project name and the basename of generated artifacts.\n\n' +
    `ASCII letters, digits, underscores, and hyphens, starting with a letter or underscore, at most ${LIMITS.nameLength} characters.`,
  step:
    '**step**` <name>():`,one ordered unit of the workflow.\n\n' +
    'Steps run in source order. The name is a unique label, not something that can be called; ' +
    `the parameter list is always empty. A workflow has 1–${LIMITS.steps} steps, each with 1–${LIMITS.asksPerStep} \`ask()\` statements indented four spaces.`,
  ask:
    '**ask**`("<request>")`,a request in natural language.\n\n' +
    'A compile-time directive: the model receives the whole workflow at once and writes the code for it. ' +
    `The generated executable never contacts the model. One nonempty string, at most ${LIMITS.requestBytes} bytes decoded.`,
};
