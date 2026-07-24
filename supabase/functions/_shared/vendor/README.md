# Vendored dependencies

## xlsx.mjs — SheetJS 0.20.3

Vendored, not fetched from a CDN, for two reasons:

1. **Supabase's function bundler refuses `cdn.sheetjs.com`** — deploying with
   `import * as XLSX from "https://cdn.sheetjs.com/..."` fails with
   `Cannot import from cdn.sheetjs.com:443`. SheetJS stopped publishing current
   versions to npm at 0.18.5, so esm.sh cannot serve 0.20.3 either.
2. **The client and the server must parse identically.** The browser preview
   uses the 0.20.3 build pinned in package.json; the edge function re-parses the
   same workbook as the authoritative source. A version skew between the two
   could make the confirmed preview disagree with what actually posts.

### Updating

Keep this in lockstep with the `xlsx` version in package.json:

```sh
npm install                       # or bun install
cp node_modules/xlsx/xlsx.mjs supabase/functions/_shared/vendor/xlsx.mjs
npx supabase functions deploy import-bank-statement
```

A test in `src/lib/bankCategorization/__tests__/` asserts the vendored copy
matches the installed package, so drift fails CI rather than surfacing as a
parsing discrepancy in production.
