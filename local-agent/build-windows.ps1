$ErrorActionPreference = 'Stop'
$agentRoot = $PSScriptRoot
$buildRoot = Join-Path $agentRoot 'dist'
$packageDir = Join-Path $buildRoot 'FlashubAgente'
$releasesDir = Join-Path (Split-Path $agentRoot -Parent) 'releases'
$resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedPackage = [System.IO.Path]::GetFullPath($packageDir)
if (!$resolvedPackage.StartsWith($resolvedBuild + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Destino de build inválido.' }
if (Test-Path -LiteralPath $resolvedPackage) { Remove-Item -LiteralPath $resolvedPackage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $packageDir, $releasesDir | Out-Null
# A distribuição inclui runtime e dependências; não copia configuração nem credenciais.
Copy-Item -LiteralPath (Join-Path $agentRoot 'src') -Destination $packageDir -Recurse -Force
$corePackage = & node -p "require('path').dirname(require.resolve('playwright-core/package.json', {paths:[process.argv[1]]}))" $agentRoot
if ($LASTEXITCODE -ne 0) { throw 'Instale as dependências do agente primeiro.' }
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir 'node_modules') | Out-Null
Copy-Item -LiteralPath $corePackage -Destination (Join-Path $packageDir 'node_modules/playwright-core') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $agentRoot 'package.json') -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $agentRoot 'LEIA-ME.txt') -Destination $packageDir -Force
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir 'runtime') | Out-Null
$nodeBinary = & node -p 'process.execPath'
if ($LASTEXITCODE -ne 0) { throw 'Runtime Node não encontrado.' }
Copy-Item -LiteralPath $nodeBinary -Destination (Join-Path $packageDir 'runtime/node.exe') -Force
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$packageDir/FlashubAgente.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $agentRoot 'windows/Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o executável Windows.' }
& (Join-Path $packageDir 'runtime/node.exe') (Join-Path $packageDir 'src/agent.js') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Falha ao testar o runtime empacotado.' }
$archive = Join-Path $releasesDir 'FlashubAgente-windows-x64.zip'
Compress-Archive -LiteralPath $packageDir -DestinationPath $archive -Force
Get-Item -LiteralPath $archive | Select-Object FullName, Length
