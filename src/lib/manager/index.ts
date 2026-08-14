/**
 * The service manager's board.
 *
 * Pure exports only — the loader lives in `./load` and is server-only, so
 * importing this barrel from a test never drags a database client along.
 */
export * from './board'
