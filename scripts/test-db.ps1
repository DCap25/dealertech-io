# ---------------------------------------------------------------------------
# Throwaway Postgres for RLS tests.
#
#   npm run db:test:up      start the container and apply the schema
#   npm run db:test:reset   tear down and rebuild from scratch
#   npm run db:test:down    remove the container
#
# Deliberately a local container rather than the Supabase project: these tests
# delete rows wholesale, which is not something to point at a database that
# will hold real dealership customer data.
# ---------------------------------------------------------------------------
param([Parameter(Position = 0)][string]$Command = 'up')

# NOT 'Stop'. PowerShell 5.1 wraps a native command's stderr in ErrorRecords,
# so psql's harmless NOTICE output would abort the script. Exit codes are the
# authority here instead.
$ErrorActionPreference = 'Continue'

$Container = 'dealertech-test-db'
$Port = '54329'
# Two databases in one container, deliberately separate:
#   dealertech_test  seeded demo data for the app
#   dealertech_rls   wiped clean by the isolation tests on every run
# Sharing one meant the seed's repair orders blocked the tests' cleanup, and
# running the tests destroyed the demo data.
$Db = 'dealertech_test'
$RlsDb = 'dealertech_rls'
$Root = Split-Path -Parent $PSScriptRoot
# Silence NOTICEs (identifier truncation, IF EXISTS skips) without hiding errors.
$PgOpts = 'PGOPTIONS=-c client_min_messages=warning'

function Apply-Sql($path, $database) {
    $name = Split-Path $path -Leaf
    # ON_ERROR_STOP makes psql exit non-zero on the first real error.
    Get-Content $path -Raw | docker exec -i -e $PgOpts $Container psql -U postgres -d $database -v ON_ERROR_STOP=1 -q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED $name on $database (psql exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [$database] $name" -ForegroundColor DarkGray
}

function Build-Database($database) {
    # Order matters: tables first, then the Supabase identity shim (which
    # creates the roles the policies grant to), then the policies themselves.
    $migrations = Get-ChildItem (Join-Path $Root 'src\db\migrations\*.sql') | Sort-Object Name
    foreach ($m in $migrations) {
        if ($m.Name -like '0000*') { Apply-Sql $m.FullName $database }
    }
    Apply-Sql (Join-Path $Root 'src\db\test\local-auth-shim.sql') $database

    # The ledger `npm run db:apply` keeps, created here because this script
    # applies the files directly and never goes through it. Without the table,
    # 0014 fails on the line that turns RLS on for it, and every migration from
    # there on is silently missing — which is how this database ended up
    # several columns behind the schema the tests are written against.
    $ledger = @"
CREATE TABLE IF NOT EXISTS public._applied_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
"@
    $ledgerFile = Join-Path $env:TEMP "dealertech-ledger.sql"
    Set-Content -Path $ledgerFile -Value $ledger -Encoding utf8
    Apply-Sql $ledgerFile $database
    Remove-Item $ledgerFile -Force

    foreach ($m in $migrations) {
        if ($m.Name -notlike '0000*') { Apply-Sql $m.FullName $database }
    }
}

function Wait-ForPostgres {
    for ($i = 0; $i -lt 30; $i++) {
        docker exec $Container pg_isready -U postgres | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Milliseconds 1000
    }
    Write-Host 'Postgres did not become ready' -ForegroundColor Red
    exit 1
}

if ($Command -eq 'down') {
    docker rm -f $Container | Out-Null
    Write-Host "removed $Container"
    exit 0
}

if ($Command -ne 'up' -and $Command -ne 'reset') {
    Write-Host 'usage: test-db.ps1 [up|reset|down]'
    exit 1
}

if ($Command -eq 'reset') { docker rm -f $Container | Out-Null }

$existing = docker ps -a --filter "name=$Container" --format '{{.Names}}' | Out-String
if ($existing -notmatch $Container) {
    Write-Host "starting $Container on port $Port ..."
    $portMap = $Port + ':5432'
    docker run -d --name $Container -e POSTGRES_PASSWORD=dealertech -e POSTGRES_DB=$Db -p $portMap postgres:16-alpine | Out-Null
} else {
    docker start $Container | Out-Null
}

Wait-ForPostgres

# Recreate the RLS database every run so isolation tests start from nothing.
"DROP DATABASE IF EXISTS $RlsDb;" | docker exec -i $Container psql -U postgres -d postgres -q | Out-Null
"CREATE DATABASE $RlsDb;" | docker exec -i $Container psql -U postgres -d postgres -q | Out-Null

Write-Host 'applying schema ...'
Build-Database $Db
Build-Database $RlsDb

$sqlCheck = "SELECT count(*) FILTER (WHERE rowsecurity) || '/' || count(*) FROM pg_tables WHERE schemaname = 'public';"
$summary = $sqlCheck | docker exec -i -e $PgOpts $Container psql -U postgres -d $Db -t -A | Select-Object -First 1
Write-Host "ready - RLS enabled on $summary tables in both $Db and $RlsDb" -ForegroundColor Green
