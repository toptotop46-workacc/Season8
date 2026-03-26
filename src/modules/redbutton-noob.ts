import { privateKeyToAccount } from 'viem/accounts'
import { rpcManager, soneiumChain } from '../rpc-manager.js'
import { safeWriteContract } from '../transaction-utils.js'
import { logger } from '../logger.js'

// Адрес контракта RedButton
const CONTRACT_ADDRESS = '0x39B4a19C687a3b9530EFE28752a81E41FdD398fa' as `0x${string}`

// ABI контракта (только функция drawItem)
const CONTRACT_ABI = [
  {
    inputs: [
      { internalType: 'uint8', name: '_gachaTypeIndex', type: 'uint8' },
      { internalType: 'uint256', name: '_deadline', type: 'uint256' },
      { internalType: 'bytes', name: '_permitSig', type: 'bytes' }
    ],
    name: 'drawItem',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
] as const

// Режим noob (фиксированно)
const GACHA_TYPE_NOOB = 0

// Параметры по умолчанию
const DEFAULT_TX_COUNT_MIN = 1
const DEFAULT_TX_COUNT_MAX = 3
const DEFAULT_DELAY_MIN_SEC = 10
const DEFAULT_DELAY_MAX_SEC = 40

// Создание клиентов
const publicClient = rpcManager.createPublicClient(soneiumChain)

/**
 * Генерирует случайное число в диапазоне [min, max] включительно
 */
function randomInt (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Задержка в миллисекундах
 */
function delay (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Выполняет одну транзакцию drawItem в режиме noob
 */
async function executeDrawItem (
  walletClient: ReturnType<typeof rpcManager.createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  txNumber: number,
  totalTxs: number
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    // Вычисляем deadline (текущее время + 1 час)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

    // Пустой permitSig (0x)
    const permitSig = '0x' as `0x${string}`

    logger.info(`[TX ${txNumber}/${totalTxs}] drawItem...`)

    // Выполняем транзакцию с безопасной отправкой
    const txResult = await safeWriteContract(
      publicClient,
      walletClient,
      account.address,
      {
        chain: soneiumChain,
        account: account,
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'drawItem',
        args: [GACHA_TYPE_NOOB, deadline, permitSig],
        value: BigInt(0) // Без ETH
      }
    )

    if (!txResult.success) {
      throw new Error(txResult.error || 'Ошибка отправки транзакции')
    }

    const hash = txResult.hash
    logger.transaction(hash, 'sent', 'REDBUTTON_NOOB')

    // Ждем подтверждения
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      logger.transaction(hash, 'confirmed', 'REDBUTTON_NOOB', account.address)
      return {
        success: true,
        hash: hash
      }
    } else {
      logger.transaction(hash, 'failed', 'REDBUTTON_NOOB', account.address)
      return {
        success: false,
        hash: hash,
        error: 'Transaction reverted'
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка'
    logger.error(`[TX ${txNumber}/${totalTxs}] Ошибка: ${errorMessage}`)
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Выполняет RedButton Noob модуль: случайное количество транзакций (1-3) в режиме noob
 */
export async function performRedButtonNoob (
  privateKey: `0x${string}`,
  options?: {
    txCountMin?: number
    txCountMax?: number
    delayMinSec?: number
    delayMaxSec?: number
  }
): Promise<{
  success: boolean
  walletAddress?: string
  transactionHash?: string
  transactionHashes?: string[]
  error?: string
  message?: string
}> {
  try {
    // Параметры с дефолтными значениями
    const txCountMin = options?.txCountMin ?? DEFAULT_TX_COUNT_MIN
    const txCountMax = options?.txCountMax ?? DEFAULT_TX_COUNT_MAX
    const delayMinSec = options?.delayMinSec ?? DEFAULT_DELAY_MIN_SEC
    const delayMaxSec = options?.delayMaxSec ?? DEFAULT_DELAY_MAX_SEC

    // Создаем аккаунт из приватного ключа
    const account = privateKeyToAccount(privateKey)

    // Создаем wallet client
    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Определяем случайное количество транзакций
    const txCount = randomInt(txCountMin, txCountMax)

    logger.info(`RedButton Noob: ${txCount} tx для ${account.address}`)

    const transactionHashes: string[] = []
    let successfulTxs = 0
    let lastError: string | undefined

    // Выполняем транзакции
    for (let txNum = 1; txNum <= txCount; txNum++) {
      const result = await executeDrawItem(walletClient, account, txNum, txCount)

      if (result.success && result.hash) {
        transactionHashes.push(result.hash)
        successfulTxs++
      } else {
        lastError = result.error
        // Продолжаем выполнение следующих транзакций даже при ошибке
      }

      // Задержка между транзакциями (кроме последней)
      if (txNum < txCount) {
        const delaySec = randomInt(delayMinSec, delayMaxSec)
        await delay(delaySec * 1000)
      }
    }

    logger.info(`RedButton Noob: ${successfulTxs}/${txCount} tx`)

    if (successfulTxs === 0) {
      return {
        success: false,
        walletAddress: account.address,
        error: lastError || 'Все транзакции провалились',
        transactionHashes: []
      }
    }

    // Формируем результат с условным добавлением transactionHash
    const result: {
      success: boolean
      walletAddress: string
      transactionHash?: string
      transactionHashes: string[]
      message: string
    } = {
      success: true,
      walletAddress: account.address,
      transactionHashes: transactionHashes,
      message: `Успешно выполнено ${successfulTxs} из ${txCount} транзакций`,
      ...(transactionHashes.length > 0 && { transactionHash: transactionHashes[0] })
    }

    return result
  } catch (error) {
    logger.error('Ошибка при выполнении RedButton Noob', error)
    throw error
  }
}
