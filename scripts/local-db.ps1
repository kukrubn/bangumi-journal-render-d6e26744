param([switch]$Stop)
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
$root=Split-Path $PSScriptRoot -Parent
$dir=Join-Path $root '.journal-local'
$config=Get-Content -Raw -LiteralPath (Join-Path $dir 'database.json') | ConvertFrom-Json
if($config.owner -notmatch '^[a-f0-9-]{36}$' -or $config.restPassword -notmatch '^[a-f0-9]{48}$'){throw 'Invalid local database configuration'}
$cmd=Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
if($cmd){$bin=Split-Path $cmd.Source}else{
  $pgRoot=Join-Path $env:ProgramFiles 'PostgreSQL'
  $ver=Get-ChildItem -LiteralPath $pgRoot -Directory | Where-Object { $_.Name -match '^\d+$' } | Sort-Object { [int]$_.Name } -Descending | Select-Object -First 1
  if(!$ver){throw 'Install PostgreSQL for Windows, then rerun npm run dev.'}
  $bin=Join-Path $ver.FullName 'bin'
}
$lock=[IO.File]::Open((Join-Path $dir 'startup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try{
$pg=Join-Path $dir 'pg'
$rest=Join-Path $dir 'rest\postgrest.exe'
$pidFile=Join-Path $dir 'rest.pid'
$running=$null
if(Test-Path -LiteralPath $pidFile){
  $idText=(Get-Content -LiteralPath $pidFile -TotalCount 1)
  if($idText -match '^\d+$'){$running=Get-Process -Id ([int]$idText) -ErrorAction SilentlyContinue}
  if($running -and $running.Path -ne $rest){$running=$null}
}
if($Stop){
  if($running){Stop-Process -Id $running.Id -ErrorAction Stop}
  if(Test-Path -LiteralPath "$pg\postmaster.pid"){& "$bin\pg_ctl.exe" -D $pg -m fast -w stop}
  return
}
if(!(Test-Path -LiteralPath $rest)){
  $zip=Join-Path $dir 'postgrest.zip'
  $digest='77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea'
  function Digest([string]$f){
    $h=[Security.Cryptography.SHA256]::Create(); $stream=[IO.File]::OpenRead($f)
    try{return [BitConverter]::ToString($h.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$h.Dispose();$stream.Dispose()}
  }
  if(!(Test-Path -LiteralPath $zip) -or (Digest $zip) -ne $digest){
    Invoke-WebRequest 'https://github.com/PostgREST/postgrest/releases/download/v16.6/postgrest-v16.6-windows-x86-64.zip' -UseBasicParsing -OutFile $zip
  }
  if((Digest $zip) -ne $digest){throw 'PostgREST SHA256 mismatch'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip,(Join-Path $dir 'rest'))
}
$env:PGPASSWORD=$config.adminPassword
$env:PGCLIENTENCODING='UTF8'
if(!(Test-Path -LiteralPath "$pg\PG_VERSION")){
  $pw=Join-Path $dir 'init.pw'
  Set-Content -LiteralPath $pw -Value $config.adminPassword -Encoding ascii
  try{& "$bin\initdb.exe" -D $pg -U journal_admin "--pwfile=$pw" -A scram-sha-256 --encoding=UTF8 --locale=C | Out-Null
    if($LASTEXITCODE){throw 'initdb failed'}
  }finally{Remove-Item -LiteralPath $pw}
}
& "$bin\pg_ctl.exe" -D $pg status *> $null
if($LASTEXITCODE -ne 0){
  & "$bin\pg_ctl.exe" -D $pg -l "$dir\pg.log" -o "-h 127.0.0.1 -p $($config.pg)" -w start
  if($LASTEXITCODE){throw 'PostgreSQL startup failed'}
}
$base=@('-h','127.0.0.1','-p',"$($config.pg)",'-U','journal_admin','-d','postgres','-v','ON_ERROR_STOP=1','-X','-q')
function RunSql([string]$sql){$sql | & "$bin\psql.exe" @base; if($LASTEXITCODE){throw 'Local database operation failed'}}
$ready=& "$bin\psql.exe" @base -Atc "select to_regclass('journal_local.migrations') is not null"
if($LASTEXITCODE){throw 'Local database connection failed'}
if($ready -ne 't'){
 RunSql @"
begin;
create schema journal_local;
create table journal_local.migrations(name text primary key);
create role anon nologin;
create role authenticated nologin;
create role journal_rest login noinherit password '$($config.restPassword)';
grant anon,authenticated to journal_rest;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claim.sub'',true),''''),nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''sub'')::uuid';
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
insert into auth.users values ('$($config.owner)');
commit;
"@
}
foreach($migration in (Get-ChildItem -LiteralPath "$root\supabase\migrations" -Filter '*.sql' | Sort-Object Name)){
  $name=$migration.Name
  if($name -notmatch '^[0-9]+_[a-z0-9_]+\.sql$'){throw 'Invalid migration name'}
  $done=& "$bin\psql.exe" @base -Atc "select exists(select 1 from journal_local.migrations where name='$name')"
  if($LASTEXITCODE){throw 'Migration status unavailable'}
  if($done -eq 't'){continue}
  $sql=[IO.File]::ReadAllText($migration.FullName)
  # Existing migrations wrap their own transaction. Track the file in that same commit.
  if($sql -notmatch '(?im)^\s*commit;\s*$'){throw "Migration must finish with COMMIT: $name"}
  $sql=[regex]::Replace($sql,'(?im)^\s*commit;\s*$',"INSERT INTO journal_local.migrations(name) VALUES ('$name');\nCOMMIT;".Replace('\n',[Environment]::NewLine))
  $stage=Join-Path $dir 'migration.sql'; [IO.File]::WriteAllText($stage,$sql,(New-Object Text.UTF8Encoding($false)))
  & "$bin\psql.exe" @base -f $stage
  if($LASTEXITCODE){throw "Migration failed: $name"}
}
RunSql "insert into app_private.app_owner(user_id) values ('$($config.owner)') on conflict (singleton) do nothing;"
if(!$running){
  @"
db-uri = "postgres://journal_rest:$($config.restPassword)@127.0.0.1:$($config.pg)/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$($config.jwt)"
server-host = "127.0.0.1"
server-port = $($config.rest)
"@ | Set-Content -LiteralPath "$dir\postgrest.conf" -Encoding ascii
  $p=Start-Process -FilePath $rest -ArgumentList @('postgrest.conf') -WorkingDirectory $dir -RedirectStandardOutput "$dir\rest.log" -RedirectStandardError "$dir\rest.err" -WindowStyle Hidden -PassThru
  $running=$p
  Set-Content -LiteralPath $pidFile $p.Id
}
$up=$false
for($i=0;$i -lt 40;$i++){
  $running.Refresh()
  if($running.HasExited){throw 'PostgREST exited; inspect .journal-local/rest.err and check the configured port'}
  try{$spec=Invoke-RestMethod "http://127.0.0.1:$($config.rest)/" -UseBasicParsing -TimeoutSec 2;if($spec.swagger -or $spec.openapi){$up=$true;break}}catch{}
  Start-Sleep -Milliseconds 200
}
if(!$up){throw 'PostgREST did not become ready; inspect .journal-local/rest.err'}
Write-Host 'Local journal database ready.'
}finally{$lock.Dispose()}
