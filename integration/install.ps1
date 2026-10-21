$ErrorActionPreference = 'Stop'
$integrationRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $integrationRoot

$sourceFrontend = Join-Path $integrationRoot 'src\frontend\annanya'
$targetFrontend = Join-Path $repoRoot 'src\frontend\annanya'
$targetTests = Join-Path $repoRoot 'tests\frontend-adapter.smoke.ts'
$serverPath = Join-Path $repoRoot 'web\server.ts'

if (!(Test-Path (Join-Path $repoRoot 'src\ast\nodes.ts'))) {
  throw "Could not find src/ast/nodes.ts. Extract this ZIP into the root of the Mini-C backend repository, then run .\integration\install.ps1."
}
if (!(Test-Path $serverPath)) {
  throw "Could not find web/server.ts. Run this installer from the extracted integration folder inside the Mini-C backend repository."
}

New-Item -ItemType Directory -Force -Path $targetFrontend | Out-Null
Copy-Item -Path (Join-Path $sourceFrontend '*') -Destination $targetFrontend -Recurse -Force
Copy-Item -Path (Join-Path $integrationRoot 'tests\frontend-adapter.smoke.ts') -Destination $targetTests -Force

$server = Get-Content -Raw -Path $serverPath
$oldImport = 'import { parseProgram, checkProgram, MiniCError } from "../src/frontend/mini_parser";'
$newImport = "import { parseProgram } from `"../src/frontend/annanya/adapter`";`r`nimport { checkProgram, MiniCError } from `"../src/frontend/mini_parser`";"
if ($server.Contains($oldImport)) {
  $server = $server.Replace($oldImport, $newImport)
  Set-Content -Path $serverPath -Value $server -Encoding utf8
  Write-Host 'Updated web/server.ts to use the shared-AST adapter.' -ForegroundColor Green
} elseif ($server.Contains('src/frontend/annanya/adapter')) {
  Write-Host 'web/server.ts already points at the adapter; left it unchanged.'
} else {
  throw "Could not find the expected parser import in web/server.ts. Files were copied, but the server import was not changed. Manually set parseProgram to ../src/frontend/annanya/adapter and keep checkProgram/MiniCError imported from ../src/frontend/mini_parser."
}

Write-Host ''
Write-Host 'Integration files installed.' -ForegroundColor Green
Write-Host 'Next run: npx ts-node tests/frontend-adapter.smoke.ts'
Write-Host 'Then run the app using the backend repository instructions.'
