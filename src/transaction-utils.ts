import { isHash, isHex, keccak256, type PublicClient, type WalletClient } from 'viem'
import { logger } from './logger.js'
import { SIMULATE_BEFORE_SEND, STRICT_SIMULATION } from './season-config.js'

const SIMULATION_TIMEOUT_MS = 30000

export interface SafeWriteContractOptions {
  allowSimulationFailure?: boolean
  simulationFailureContext?: string
}

interface NormalizedTransactionIdentifier {
  hash?: `0x${string}`
  normalizedFromRaw: boolean
}

/**
 * Нормализует сообщение об ошибке симуляции
 */
function normalizeSimulationError (message: string): string {
  if (message.includes('revert') || message.includes('execution reverted')) {
    return 'Транзакция откатится (revert)'
  }
  if (message.includes('insufficient funds') || message.includes('insufficient balance')) {
    return 'Недостаточно средств'
  }
  if (message.includes('timeout') || message.includes('Таймаут')) {
    return 'Таймаут симуляции'
  }
  return message
}

function normalizeTransactionIdentifier (
  value: unknown,
  context: string
): NormalizedTransactionIdentifier {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    return { normalizedFromRaw: false }
  }

  if (isHash(value)) {
    return { hash: value as `0x${string}`, normalizedFromRaw: false }
  }

  if (value.length > 66 && isHex(value, { strict: false })) {
    logger.warn(`${context}: RPC вернул raw transaction вместо tx hash, вычисляем hash локально`)
    return {
      hash: keccak256(value as `0x${string}`),
      normalizedFromRaw: true
    }
  }

  return { normalizedFromRaw: false }
}

function extractHashFromError (
  error: unknown,
  errorMessage: string,
  context: string
): `0x${string}` | undefined {
  const candidates: unknown[] = []

  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>
    candidates.push(errorObj['hash'])

    if (errorObj['data'] && typeof errorObj['data'] === 'object') {
      candidates.push((errorObj['data'] as Record<string, unknown>)['hash'])
    }

    if (errorObj['cause'] && typeof errorObj['cause'] === 'object') {
      candidates.push((errorObj['cause'] as Record<string, unknown>)['hash'])
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeTransactionIdentifier(candidate, context)
    if (normalized.hash) return normalized.hash
  }

  const hashMatch = errorMessage.match(/0x[a-fA-F0-9]{64}\b/)
  if (hashMatch) {
    return hashMatch[0] as `0x${string}`
  }

  return undefined
}

/**
 * Симулирует writeContract через publicClient.simulateContract
 */
async function simulateWriteContract (
  publicClient: PublicClient,
  accountAddress: `0x${string}`,
  contractParams: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { nonce: _n, ...params } = contractParams
    const config = {
      ...params,
      account: (params['account'] as `0x${string}`) ?? accountAddress
    }
    const promise = publicClient.simulateContract(config as Parameters<PublicClient['simulateContract']>[0])
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Таймаут симуляции транзакции')), SIMULATION_TIMEOUT_MS)
    )
    await Promise.race([promise, timeout])
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: normalizeSimulationError(msg) }
  }
}

/**
 * Симулирует сырую транзакцию через publicClient.call
 */
async function simulateSendTransaction (
  publicClient: PublicClient,
  accountAddress: `0x${string}`,
  transactionParams: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const to = transactionParams['to'] as `0x${string}` | undefined
  const data = transactionParams['data'] as `0x${string}` | undefined
  if (!to || !data) {
    return { success: false, error: 'Отсутствуют to или data для симуляции' }
  }
  const value = BigInt((transactionParams['value'] as string) ?? '0')
  try {
    const promise = publicClient.call({
      to,
      data,
      value,
      account: accountAddress
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Таймаут симуляции транзакции')), SIMULATION_TIMEOUT_MS)
    )
    await Promise.race([promise, timeout])
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: normalizeSimulationError(msg) }
  }
}

/**
 * Утилиты для безопасной отправки транзакций с проверкой nonce и симуляцией
 */

export interface TransactionSafetyCheck {
  canProceed: boolean
  pendingTransactions: string[]
  currentNonce: number
  recommendedNonce: number
  warnings: string[]
}

export function shouldBypassFailedSimulationInStrictMode (params: {
  strictSimulation: boolean
  allowSimulationFailure?: boolean
}): boolean {
  const { strictSimulation, allowSimulationFailure = false } = params

  return strictSimulation && allowSimulationFailure
}

/**
 * Проверяет безопасность отправки транзакции
 */
export async function checkTransactionSafety (
  publicClient: PublicClient,
  walletClient: WalletClient,
  accountAddress: `0x${string}`
): Promise<TransactionSafetyCheck> {
  const warnings: string[] = []
  const pendingTransactions: string[] = []

  try {
    // Получаем текущий nonce
    const currentNonce = await publicClient.getTransactionCount({
      address: accountAddress,
      blockTag: 'latest'
    })

    // Получаем pending nonce
    const pendingNonce = await publicClient.getTransactionCount({
      address: accountAddress,
      blockTag: 'pending'
    })

    // Рекомендуемый nonce должен быть pendingNonce (следующий доступный)
    const recommendedNonce = pendingNonce

    // Проверяем, есть ли pending транзакции
    if (pendingNonce > currentNonce) {
      warnings.push(`Обнаружено ${pendingNonce - currentNonce} pending транзакций`)
    }

    // Проверяем, можно ли безопасно отправить транзакцию
    // Если есть pending транзакции, лучше подождать
    const canProceed = pendingNonce === currentNonce

    if (!canProceed) {
      warnings.push('Нельзя отправить транзакцию - есть pending операции')
    }

    return {
      canProceed,
      pendingTransactions,
      currentNonce: Number(currentNonce),
      recommendedNonce: Number(recommendedNonce),
      warnings
    }

  } catch (error) {
    logger.error('Ошибка при проверке безопасности транзакции', error)
    return {
      canProceed: false,
      pendingTransactions: [],
      currentNonce: 0,
      recommendedNonce: 0,
      warnings: ['Ошибка при проверке nonce']
    }
  }
}

/**
 * Ждет завершения всех pending транзакций
 */
export async function waitForPendingTransactions (
  publicClient: PublicClient,
  accountAddress: `0x${string}`,
  maxWaitTime: number = 60000 // 60 секунд
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const currentNonce = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: 'latest'
      })

      const pendingNonce = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: 'pending'
      })

      if (pendingNonce === currentNonce) {
        return true
      }

      await new Promise(resolve => setTimeout(resolve, 15000))

    } catch (error) {
      logger.error('Ошибка при ожидании pending транзакций', error)
      return false
    }
  }

  logger.warn('Таймаут ожидания pending транзакций')
  return false
}

/**
 * Безопасная отправка транзакции с проверкой nonce
 */
export async function safeSendTransaction (
  publicClient: PublicClient,
  walletClient: WalletClient,
  accountAddress: `0x${string}`,
  transactionParams: Record<string, unknown>,
  maxRetries: number = 3
): Promise<{ hash: `0x${string}`; success: boolean; error?: string }> {

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (SIMULATE_BEFORE_SEND) {
        const sim = await simulateSendTransaction(publicClient, accountAddress, transactionParams)
        if (!sim.success) {
          logger.warn(`Симуляция неудачна: ${sim.error}`)
          if (STRICT_SIMULATION) {
            return {
              hash: '0x' as `0x${string}`,
              success: false,
              error: `Симуляция: ${sim.error}`
            }
          }
          logger.warn('Продолжаем отправку несмотря на ошибку симуляции (STRICT_SIMULATION=false)')
        }
      }

      const safetyCheck = await checkTransactionSafety(publicClient, walletClient, accountAddress)

      if (!safetyCheck.canProceed) {
        const waited = await waitForPendingTransactions(publicClient, accountAddress)

        if (!waited) {
          if (attempt === maxRetries) {
            return {
              hash: '0x' as `0x${string}`,
              success: false,
              error: 'Не удалось дождаться завершения pending транзакций'
            }
          }
          continue
        }
      }

      const finalNonceCheck = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: 'pending'
      })

      if (finalNonceCheck !== safetyCheck.recommendedNonce) {
        safetyCheck.recommendedNonce = finalNonceCheck
      }

      const returnedIdentifier = await walletClient.sendTransaction({
        ...transactionParams,
        nonce: safetyCheck.recommendedNonce
      } as Parameters<typeof walletClient.sendTransaction>[0])

      const normalized = normalizeTransactionIdentifier(returnedIdentifier, 'safeSendTransaction')
      if (!normalized.hash) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: 'RPC вернул некорректный идентификатор транзакции'
        }
      }

      // Не логируем здесь - это будет сделано в модулях через logger.transaction()
      // Убираем дублирование логов
      return { hash: normalized.hash, success: true }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка'
      // Если это ошибка nonce, не логируем полную ошибку
      if (errorMessage.includes('nonce') || errorMessage.includes('replacement')) {
        await new Promise(resolve => setTimeout(resolve, 30000))
        continue
      }

      // Contract revert детерминирован — повторные попытки бессмысленны
      if (errorMessage.includes('reverted') || errorMessage.includes('revert')) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: errorMessage
        }
      }

      logger.error(`Ошибка попытки ${attempt}: ${errorMessage}`)

      if (attempt === maxRetries) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: errorMessage
        }
      }

      await new Promise(resolve => setTimeout(resolve, 15000))
    }
  }

  return {
    hash: '0x' as `0x${string}`,
    success: false,
    error: 'Исчерпаны все попытки'
  }
}

/**
 * Безопасная отправка writeContract с проверкой nonce (БЕЗ симуляции)
 * Используется для контрактов, где simulateContract дает false negative
 */
export async function safeWriteContractWithoutSimulation (
  publicClient: PublicClient,
  walletClient: WalletClient,
  accountAddress: `0x${string}`,
  contractParams: Record<string, unknown>,
  maxRetries: number = 3
): Promise<{ hash: `0x${string}`; success: boolean; error?: string }> {

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Пропускаем симуляцию - отправляем транзакцию напрямую

      const safetyCheck = await checkTransactionSafety(publicClient, walletClient, accountAddress)

      if (!safetyCheck.canProceed) {
        const waited = await waitForPendingTransactions(publicClient, accountAddress)

        if (!waited) {
          if (attempt === maxRetries) {
            return {
              hash: '0x' as `0x${string}`,
              success: false,
              error: 'Не удалось дождаться завершения pending транзакций'
            }
          }
          continue
        }
      }

      const finalNonceCheck = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: 'pending'
      })

      if (finalNonceCheck !== safetyCheck.recommendedNonce) {
        safetyCheck.recommendedNonce = finalNonceCheck
      }

      const returnedIdentifier = await walletClient.writeContract({
        ...contractParams,
        nonce: safetyCheck.recommendedNonce
      } as Parameters<typeof walletClient.writeContract>[0])

      const normalized = normalizeTransactionIdentifier(returnedIdentifier, 'safeWriteContractWithoutSimulation')
      if (!normalized.hash) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: 'RPC вернул некорректный идентификатор транзакции'
        }
      }

      return { hash: normalized.hash, success: true }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка'
      const extractedHash = extractHashFromError(error, errorMessage, 'safeWriteContractWithoutSimulation')

      if (extractedHash) {
        return { hash: extractedHash, success: true }
      }

      if (errorMessage.includes('nonce') || errorMessage.includes('replacement')) {
        await new Promise(resolve => setTimeout(resolve, 30000))
        continue
      }

      // Contract revert детерминирован — повторные попытки бессмысленны
      if (errorMessage.includes('reverted') || errorMessage.includes('revert')) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: errorMessage
        }
      }

      logger.error(`Ошибка попытки ${attempt}: ${errorMessage}`)

      if (attempt === maxRetries) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: errorMessage
        }
      }

      await new Promise(resolve => setTimeout(resolve, 15000))
    }
  }

  return {
    hash: '0x' as `0x${string}`,
    success: false,
    error: 'Исчерпаны все попытки'
  }
}

/**
 * Безопасная отправка writeContract с проверкой nonce
 */
export async function safeWriteContract (
  publicClient: PublicClient,
  walletClient: WalletClient,
  accountAddress: `0x${string}`,
  contractParams: Record<string, unknown>,
  maxRetries: number = 3,
  options: SafeWriteContractOptions = {}
): Promise<{ hash: `0x${string}`; success: boolean; error?: string }> {
  const { allowSimulationFailure = false, simulationFailureContext } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (SIMULATE_BEFORE_SEND) {
        const sim = await simulateWriteContract(publicClient, accountAddress, contractParams)
        if (!sim.success) {
          logger.warn(`Симуляция неудачна: ${sim.error}`)
          if (shouldBypassFailedSimulationInStrictMode({
            strictSimulation: STRICT_SIMULATION,
            allowSimulationFailure
          })) {
            logger.warn(
              simulationFailureContext ??
              'Продолжаем отправку несмотря на ошибку симуляции (verified fallback policy)'
            )
          } else if (STRICT_SIMULATION) {
            return {
              hash: '0x' as `0x${string}`,
              success: false,
              error: `Симуляция: ${sim.error}`
            }
          }
          logger.warn('Продолжаем отправку несмотря на ошибку симуляции (STRICT_SIMULATION=false)')
        }
      }

      const safetyCheck = await checkTransactionSafety(publicClient, walletClient, accountAddress)

      if (!safetyCheck.canProceed) {
        const waited = await waitForPendingTransactions(publicClient, accountAddress)

        if (!waited) {
          if (attempt === maxRetries) {
            return {
              hash: '0x' as `0x${string}`,
              success: false,
              error: 'Не удалось дождаться завершения pending транзакций'
            }
          }
          continue
        }
      }

      const finalNonceCheck = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: 'pending'
      })

      if (finalNonceCheck !== safetyCheck.recommendedNonce) {
        safetyCheck.recommendedNonce = finalNonceCheck
      }

      const returnedIdentifier = await walletClient.writeContract({
        ...contractParams,
        nonce: safetyCheck.recommendedNonce
      } as Parameters<typeof walletClient.writeContract>[0])

      const normalized = normalizeTransactionIdentifier(returnedIdentifier, 'safeWriteContract')
      if (!normalized.hash) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: 'RPC вернул некорректный идентификатор транзакции'
        }
      }

      // Не логируем здесь - это будет сделано в модулях через logger.transaction()
      // Убираем дублирование логов
      return { hash: normalized.hash, success: true }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка'
      const extractedHash = extractHashFromError(error, errorMessage, 'safeWriteContract')

      if (extractedHash) {
        return { hash: extractedHash, success: true }
      }

      if (errorMessage.includes('nonce') || errorMessage.includes('replacement')) {
        await new Promise(resolve => setTimeout(resolve, 30000))
        continue
      } else {
        // Для других ошибок логируем полную информацию
        logger.error(`Ошибка попытки ${attempt}: ${errorMessage}`)
      }

      if (attempt === maxRetries) {
        return {
          hash: '0x' as `0x${string}`,
          success: false,
          error: errorMessage
        }
      }

      // Ждем перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, 15000))
    }
  }

  return {
    hash: '0x' as `0x${string}`,
    success: false,
    error: 'Исчерпаны все попытки'
  }
}
