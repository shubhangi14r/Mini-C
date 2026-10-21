# MiniC grammar

Notation: `'x'` is a token, `*` zero or more, `?` optional, `|` alternative.
Bracketed **[Phase N]** marks parts the parser does not accept yet; it reports
`not supported yet (Phase N)` for them.

## Implemented (Phases 2–3)

```
program      := funcDecl* EOF
funcDecl     := type IDENT '(' (param (',' param)*)? ')' block
param        := type IDENT                      -- type must not be 'void'
type         := 'int' | 'void'
block        := '{' statement* '}'

statement    := varDecl | ifStmt | whileStmt | forStmt | doWhile
              | 'break' ';' | 'continue' ';' | returnStmt | block
              | simpleStmt ';'
varDecl      := 'int' IDENT ('=' expr)? ';'
returnStmt   := 'return' expr? ';'
ifStmt       := 'if' '(' expr ')' statement ['else' statement]
whileStmt    := 'while' '(' expr ')' statement
doWhile      := 'do' statement 'while' '(' expr ')' ';'
forStmt      := 'for' '(' [varDecl | simpleStmt ';'] [expr] ';' [simpleStmt] ')' statement
simpleStmt   := assignment | incDec | expr      -- no trailing ';' (reused by 'for')
assignment   := IDENT ('=' | '+=' | '-=' | '*=' | '/=' | '%=') expr
incDec       := IDENT ('++' | '--')

expr         := binary(1)
binary(p)    := unary (OP unary)*               -- precedence climbing, left-assoc
unary        := ('-' | '!') unary | postfix
postfix      := primary ('(' (expr (',' expr)*)? ')')*   -- only IDENT can be called
primary      := INT | IDENT | '(' expr ')'
```

Assignment is a **statement**, not an expression: `a = b = 3` and `f(x = 1)` are errors.
`IDENT` on the left of an assignment is checked after parsing: anything that is
not a plain variable gives `cannot assign to this expression`.

## Binary operator precedence (lowest to highest, all left-associative)

| p | operators | node |
|---|-----------|------|
| 1 | `\|\|` | Logical |
| 2 | `&&` | Logical |
| 3 | `\|` | Binary |
| 4 | `^` | Binary |
| 5 | `&` | Binary |
| 6 | `==` `!=` | Binary |
| 7 | `<` `<=` `>` `>=` | Binary |
| 8 | `<<` `>>` | Binary |
| 9 | `+` `-` | Binary |
| 10 | `*` `/` `%` | Binary |

## Desugaring (done in the parser)

| source | AST |
|--------|-----|
| `x += e` (also `-= *= /= %=`) | `Assign(x, Binary(op, VarRef x, e))` |
| `x++` / `x--` | `Assign(x, Binary("+" / "-", VarRef x, IntLit 1))` |
| `a && b`, `a \|\| b` | `Logical` |
| `-2147483648` | one `IntLit` with value -2147483648 |

## Node positions

`line`/`col` (1-based) point at: the first token for `Func`, `VarDecl`, `Return`,
`Assign`, `ExprStmt`; the identifier for `VarRef` and `Call`; the literal for
`IntLit`; the **operator** for `Binary`, `Logical` and `Unary`. For `x++` the
generated `Binary` and `IntLit 1` sit at the `++` token.

## Not yet accepted

- **[Phase 4]** `long float bool char` types, their literals, casts `(type)x`
- **[Phase 5]** `string`, arrays, `struct`, pointers, `.` `->` `[ ]`, `new`, `null`, string literals, global variables, forward declarations
- **[Phase 7]** `switch`, `?:`
- `~` waits for `Unary.op` to be extended in the AST contract
