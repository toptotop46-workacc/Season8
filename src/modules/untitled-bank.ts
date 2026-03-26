import { formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ensureUSDCBalance } from '../usdc-balance-manager.js'
import { rpcManager, soneiumChain } from '../rpc-manager.js'
import { safeWriteContract } from '../transaction-utils.js'
import { logger } from '../logger.js'

// Адреса контрактов Untitled Bank
const BANK_CONTRACT = '0xc675BB95D73CA7db2C09c3dC04dAaA7944CCBA41' // Bank контракт (UB-USDC токен)
const UNTITLED_HUB = '0x2469362f63e9f593087EBbb5AC395CA607B5842F' // UntitledHub контракт
const USDC_E_TOKEN = '0xba9986d2381edf1da03b0b9c1f8b00dc4aacc369' // USDC.e токен

// ABI для ERC20 токена (USDC.e)
const ERC20_ABI = [
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'owner', 'type': 'address' },
      { 'internalType': 'address', 'name': 'spender', 'type': 'address' }
    ],
    'name': 'allowance',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'spender', 'type': 'address' },
      { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'approve',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'address', 'name': 'account', 'type': 'address' }],
    'name': 'balanceOf',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'decimals',
    'outputs': [{ 'internalType': 'uint8', 'name': '', 'type': 'uint8' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'symbol',
    'outputs': [{ 'internalType': 'string', 'name': '', 'type': 'string' }],
    'stateMutability': 'view',
    'type': 'function'
  }
] as const

// ABI для Bank контракта (функции deposit, redeem, balanceOf)
const BANK_ABI = [
  {
    'inputs': [
      { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' },
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' }
    ],
    'name': 'deposit',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'uint256', 'name': 'shares', 'type': 'uint256' },
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'internalType': 'address', 'name': 'owner', 'type': 'address' }
    ],
    'name': 'redeem',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'account', 'type': 'address' }
    ],
    'name': 'balanceOf',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'totalSupply',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  }
] as const

// Создание публичного клиента
const publicClient = rpcManager.createPublicClient(soneiumChain)

/**
 * Получает баланс USDC.e токена для указанного адреса
 */
export async function getUSDCBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address]
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(balance, decimals)
  } catch (error) {
    logger.error('Ошибка при получении баланса USDC.e', error)
    throw error
  }
}

/**
 * Получает баланс депозитов в Untitled Bank для указанного адреса
 */
export async function getBankBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: BANK_CONTRACT,
      abi: BANK_ABI,
      functionName: 'balanceOf',
      args: [address]
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(balance, decimals)
  } catch (error) {
    logger.error('Ошибка при получении баланса Bank токенов', error)
    throw error
  }
}

/**
 * Проверяет allowance (разрешение) для Untitled Bank контракта
 */
export async function checkAllowance (owner: `0x${string}`, amount: string): Promise<boolean> {
  try {
    const allowance = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, BANK_CONTRACT]
    })

    // Проверяем, есть ли безлимитный approve (максимальное значение uint256)
    const maxAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    const hasUnlimitedAllowance = allowance >= maxAmount

    if (hasUnlimitedAllowance) {
      return true
    }

    // Если нет безлимитного, проверяем обычный allowance
    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(amount, decimals)
    const hasEnoughAllowance = allowance >= amountWei

    return hasEnoughAllowance
  } catch (error) {
    logger.error('Ошибка при проверке allowance', error)
    throw error
  }
}

/**
 * Выполняет approve для Untitled Bank контракта на указанную сумму
 */
export async function approveUSDC (privateKey: `0x${string}`, amount: string): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Получаем decimals токена
    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    // Конвертируем сумму в wei
    const amountWei = parseUnits(amount, decimals)

    // Получаем рекомендуемый лимит газа и увеличиваем на 50%
    const estimatedGas = await publicClient.estimateContractGas({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [BANK_CONTRACT, amountWei],
      account: account
    })

    const gasLimit = BigInt(Math.floor(Number(estimatedGas) * 1.5))

    // Отправляем транзакцию с безопасной отправкой
    const txResult = await safeWriteContract(
      publicClient,
      walletClient,
      account.address,
      {
        chain: soneiumChain,
        account: account,
        address: USDC_E_TOKEN,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BANK_CONTRACT, amountWei],
        gas: gasLimit
      }
    )

    if (!txResult.success) {
      throw new Error(txResult.error || 'Ошибка отправки транзакции')
    }

    const hash = txResult.hash

    // Ожидаем подтверждения
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      logger.transaction(hash, 'confirmed', 'UNTITLED_BANK', account.address)
      await new Promise(resolve => setTimeout(resolve, 30000))
    } else {
      logger.transaction(hash, 'failed', 'UNTITLED_BANK')
      throw new Error('Approve transaction failed')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении approve', error)
    throw error
  }
}

/**
 * Добавляет депозит в Untitled Bank
 */
export async function deposit (privateKey: `0x${string}`, amount: string): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(amount, decimals)

    // Добавляем депозит с увеличенным лимитом газа
    let hash: `0x${string}`
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>

    try {
      // Получаем рекомендуемый лимит газа и увеличиваем на 50%
      const estimatedGas = await publicClient.estimateContractGas({
        address: BANK_CONTRACT,
        abi: BANK_ABI,
        functionName: 'deposit',
        args: [amountWei, account.address],
        account: account
      })

      const gasLimit = BigInt(Math.floor(Number(estimatedGas) * 1.5))

      // Отправляем транзакцию с безопасной отправкой
      const txResult = await safeWriteContract(
        publicClient,
        walletClient,
        account.address,
        {
          chain: soneiumChain,
          account: account,
          address: BANK_CONTRACT,
          abi: BANK_ABI,
          functionName: 'deposit',
          args: [amountWei, account.address], // amount, receiver
          gas: gasLimit
        }
      )

      if (!txResult.success) {
        throw new Error(txResult.error || 'Ошибка отправки транзакции')
      }

      hash = txResult.hash

      // Ожидаем подтверждения
      receipt = await publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      // Если ошибка связана с газом, пробуем с еще большим лимитом
      if (error instanceof Error && error.message.includes('gas')) {
        logger.warn('Ошибка газа, пробуем с увеличенным лимитом...')

        // Retry с безопасной отправкой
        const retryResult = await safeWriteContract(
          publicClient,
          walletClient,
          account.address,
          {
            chain: soneiumChain,
            account: account,
            address: BANK_CONTRACT,
            abi: BANK_ABI,
            functionName: 'deposit',
            args: [amountWei, account.address],
            gas: 800000n // Еще больший лимит газа
          }
        )

        if (!retryResult.success) {
          throw new Error(retryResult.error || 'Ошибка retry транзакции')
        }

        hash = retryResult.hash
        receipt = await publicClient.waitForTransactionReceipt({ hash })
      } else {
        throw error
      }
    }

    if (receipt.status === 'success') {
      await new Promise(resolve => setTimeout(resolve, 30000))
    } else {
      logger.transaction(hash, 'failed', 'UNTITLED_BANK')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении депозита', error)
    throw error
  }
}

/**
 * Получает общий supply Bank токенов
 */
export async function getBankTotalSupply (): Promise<string> {
  try {
    const totalSupply = await publicClient.readContract({
      address: BANK_CONTRACT,
      abi: BANK_ABI,
      functionName: 'totalSupply'
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(totalSupply, decimals)
  } catch (error) {
    logger.error('Ошибка при получении общего supply Bank токенов', error)
    throw error
  }
}

/**
 * Выводит депозит (withdraw) из Untitled Bank
 */
export async function withdraw (privateKey: `0x${string}`, amount: string | null = null): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Получаем текущий баланс депозитов
    const bankBalance = await getBankBalance(account.address)

    if (parseFloat(bankBalance) === 0) {
      throw new Error('Нет депозитов для вывода')
    }

    // Определяем количество для вывода
    const withdrawAmount = amount || bankBalance
    if (parseFloat(withdrawAmount) > parseFloat(bankBalance)) {
      throw new Error('Недостаточно депозитов для указанной суммы')
    }

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(withdrawAmount, decimals)

    // Выводим депозит с увеличенным лимитом газа
    let hash: `0x${string}`
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>

    try {
      // Отправляем транзакцию с безопасной отправкой
      const txResult = await safeWriteContract(
        publicClient,
        walletClient,
        account.address,
        {
          chain: soneiumChain,
          account: account,
          address: BANK_CONTRACT,
          abi: BANK_ABI,
          functionName: 'redeem',
          args: [amountWei, account.address, account.address], // shares, receiver, owner
          gas: 500000n // Увеличенный лимит газа для сложной операции Untitled Bank
        }
      )

      if (!txResult.success) {
        throw new Error(txResult.error || 'Ошибка отправки транзакции')
      }

      hash = txResult.hash

      // Ожидаем подтверждения
      receipt = await publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      // Если ошибка связана с газом, пробуем с еще большим лимитом
      if (error instanceof Error && error.message.includes('gas')) {
        logger.warn('Ошибка газа, пробуем с увеличенным лимитом...')

        // Retry с безопасной отправкой
        const retryResult = await safeWriteContract(
          publicClient,
          walletClient,
          account.address,
          {
            chain: soneiumChain,
            account: account,
            address: BANK_CONTRACT,
            abi: BANK_ABI,
            functionName: 'redeem',
            args: [amountWei, account.address, account.address],
            gas: 800000n // Еще больший лимит газа
          }
        )

        if (!retryResult.success) {
          throw new Error(retryResult.error || 'Ошибка retry транзакции')
        }

        hash = retryResult.hash
        receipt = await publicClient.waitForTransactionReceipt({ hash })
      } else {
        throw error
      }
    }

    if (receipt.status === 'success') {
      await new Promise(resolve => setTimeout(resolve, 30000))
    } else {
      logger.transaction(hash, 'failed', 'UNTITLED_BANK')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выводе депозита', error)
    throw error
  }
}

/**
 * Получает информацию о балансе ETH
 */
export async function getETHBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.getBalance({ address })
    return formatUnits(balance, 18)
  } catch (error) {
    logger.error('Ошибка при получении баланса ETH', error)
    throw error
  }
}

/**
 * Выводит детальную информацию о депозитах
 */
export async function displayDepositInfo (_userAddress: `0x${string}`, _operation: string, _amount: string, _transactionHash: string): Promise<void> {}

/**
 * Полный процесс управления депозитами с проверками
 */
export async function performDepositManagement (privateKey: `0x${string}`, amount: string | null = null): Promise<{
  success: boolean
  walletAddress?: string
  usdcBalance?: string
  bankBalance?: string
  depositAmount?: string
  depositTransactionHash?: string
  withdrawTransactionHash?: string | null
  explorerUrl?: string
  usdcPurchased?: boolean
  usdcPurchaseHash?: string | undefined
  usdcPurchaseAmount?: string | undefined
  error?: string
}> {
  try {
    const account = privateKeyToAccount(privateKey)
    logger.info(`[UntitledBank] Кошелек: ${account.address}`)

    const bankBalance = await getBankBalance(account.address)

    if (parseFloat(bankBalance) > 0) {
      logger.info('Обнаружены существующие депозиты, выводим...')
      const withdrawTxHash = await withdraw(privateKey)

      await displayDepositInfo(account.address, 'withdraw', bankBalance, withdrawTxHash)

      return {
        success: true,
        walletAddress: account.address,
        bankBalance: bankBalance,
        withdrawTransactionHash: withdrawTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${withdrawTxHash}`
      }
    } else {
      const usdcBalanceResult = await ensureUSDCBalance(privateKey, '0.0001')

      if (!usdcBalanceResult.success) {
        throw new Error(`Не удалось обеспечить наличие USDC.e: ${usdcBalanceResult.error}`)
      }

      const usdcBalance = usdcBalanceResult.usdcBalance

      const depositAmount = amount || usdcBalance
      if (parseFloat(depositAmount) > parseFloat(usdcBalance)) {
        throw new Error('Недостаточно USDC.e на балансе для указанной суммы')
      }

      logger.info(`Количество для депозита: ${depositAmount} USDC.e`)

      const hasAllowance = await checkAllowance(account.address, depositAmount)

      if (!hasAllowance) {
        await approveUSDC(privateKey, depositAmount)
      }

      const depositTxHash = await deposit(privateKey, depositAmount)

      await displayDepositInfo(account.address, 'deposit', depositAmount, depositTxHash)

      return {
        success: true,
        walletAddress: account.address,
        usdcBalance: usdcBalance,
        bankBalance: bankBalance,
        depositAmount: depositAmount,
        depositTransactionHash: depositTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${depositTxHash}`,
        usdcPurchased: usdcBalanceResult.purchased || false,
        usdcPurchaseHash: usdcBalanceResult.purchaseHash || undefined,
        usdcPurchaseAmount: usdcBalanceResult.purchaseAmount || undefined
      }
    }

  } catch (error) {
    logger.error('Ошибка при управлении депозитами', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка'
    }
  }
}

// Экспорт констант для использования в других модулях
export {
  BANK_CONTRACT,
  UNTITLED_HUB,
  USDC_E_TOKEN,
  ERC20_ABI,
  BANK_ABI
}
