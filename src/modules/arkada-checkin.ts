import { formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { rpcManager, soneiumChain } from '../rpc-manager.js'
import { safeWriteContract } from '../transaction-utils.js'
import { logger } from '../logger.js'

// Адрес контракта DailyCheck
const CONTRACT_ADDRESS = '0x98826e728977B25279ad7629134FD0e96bd5A7b2'

// ABI контракта (только нужные функции)
const CONTRACT_ABI = [
  {
    'inputs': [],
    'name': 'check',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'user',
        'type': 'address'
      }
    ],
    'name': 'checkDatas',
    'outputs': [
      {
        'internalType': 'uint256',
        'name': 'streak',
        'type': 'uint256'
      },
      {
        'internalType': 'uint256',
        'name': 'timestamp',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  }
] as const

// Создание клиентов
const publicClient = rpcManager.createPublicClient(soneiumChain)

/**
 * Проверяет доступность функции check для указанного адреса
 */
export async function checkDatas (userAddress: `0x${string}`): Promise<{
  streak: number
  timestamp: number
  canCheck: boolean
  timeSinceLastCheck: number
}> {
  try {
    const result = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'checkDatas',
      args: [userAddress]
    })

    const [streak, timestamp] = result
    const currentTime = Math.floor(Date.now() / 1000)

    // Проверяем, можно ли делать check (обычно раз в 24 часа)
    const timeSinceLastCheck = currentTime - Number(timestamp)
    const canCheck = timeSinceLastCheck >= 86400 // 24 часа в секундах

    return {
      streak: Number(streak),
      timestamp: Number(timestamp),
      canCheck,
      timeSinceLastCheck
    }
  } catch (error) {
    logger.error('Ошибка при проверке данных', error)
    throw error
  }
}

/**
 * Выполняет транзакцию check
 */
export async function performCheck (privateKey: `0x${string}`): Promise<string> {
  try {
    // Создаем аккаунт из приватного ключа
    const account = privateKeyToAccount(privateKey)

    // Создаем wallet client
    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Проверяем, можно ли делать check
    const userData = await checkDatas(account.address)

    if (!userData.canCheck) {
      const hoursLeft = Math.ceil((86400 - userData.timeSinceLastCheck) / 3600)
      logger.warn(`Check недоступен. Попробуйте через ${hoursLeft} часов.`)
      throw new Error(`Check недоступен. Попробуйте через ${hoursLeft} часов.`)
    }

    // Получаем данные пользователя

    // Выполняем транзакцию check с безопасной отправкой
    const txResult = await safeWriteContract(
      publicClient,
      walletClient,
      account.address,
      {
        chain: soneiumChain,
        account: account,
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'check'
      }
    )

    if (!txResult.success) {
      throw new Error(txResult.error || 'Ошибка отправки транзакции')
    }

    const hash = txResult.hash

    // Ждем подтверждения
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      // Получаем обновленные данные
      await checkDatas(account.address)
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении check', error)
    throw error
  }
}

/**
 * Получает информацию о балансе кошелька
 */
export async function getBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.getBalance({
      address: address
    })
    return formatEther(balance)
  } catch (error) {
    logger.error('Ошибка при получении баланса', error)
    throw error
  }
}

/**
 * Основная функция модуля Arkada Check-in
 */
export async function performArkadaCheckin (privateKey: `0x${string}`): Promise<{
  success: boolean
  walletAddress?: string
  streak?: number
  transactionHash?: string
  error?: string
  message?: string
}> {
  try {
    const account = privateKeyToAccount(privateKey)
    // Проверяем баланс
    await getBalance(account.address)

    // Проверяем данные check
    const checkData = await checkDatas(account.address)

    // Если можно делать check, выполняем его
    if (checkData.canCheck) {
      const txHash = await performCheck(privateKey)
      return {
        success: true,
        walletAddress: account.address,
        streak: checkData.streak + 1,
        transactionHash: txHash
      }
    } else {
      const hoursLeft = Math.ceil((86400 - checkData.timeSinceLastCheck) / 3600)
      logger.warn(`Check недоступен. Попробуйте через ${hoursLeft} часов.`)
      return {
        success: true,
        walletAddress: account.address,
        streak: checkData.streak,
        message: `Check недоступен. Попробуйте через ${hoursLeft} часов.`
      }
    }
  } catch (error) {
    logger.error('Ошибка выполнения Arkada Check-in', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка'
    }
  }
}

// Экспорт констант для использования в других модулях
export {
  CONTRACT_ADDRESS,
  CONTRACT_ABI
}
