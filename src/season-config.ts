/**
 * Единая конфигурация текущего сезона.
 * Смена сезона и порога завершённости — в одном месте.
 */
export const CURRENT_SEASON = 8
/** Порог поинтов для статуса «завершён» (>= включительно). */
export const POINTS_LIMIT_SEASON = 80

/** Минимальный процент от баланса ETH для свапа в USDC.e (через Jumper). Дробные значения допустимы, например 0.1 = 0.1%, 1 = 1%, 15 = 15%. */
export const LIQUIDITY_SWAP_PERCENT_MIN = 0.1
/** Максимальный процент от баланса ETH для свапа в USDC.e (через Jumper). Дробные значения допустимы. */
export const LIQUIDITY_SWAP_PERCENT_MAX = 1

/** Симулировать транзакцию перед отправкой (eth_call / simulateContract). Отключить при глючном RPC. */
export const SIMULATE_BEFORE_SEND = true
