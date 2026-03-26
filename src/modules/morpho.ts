import { formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ensureUSDCBalance } from '../usdc-balance-manager.js'
import { rpcManager, soneiumChain } from '../rpc-manager.js'
import { safeWriteContract } from '../transaction-utils.js'
import { logger } from '../logger.js'

// Адреса контрактов Morpho
const METAMORPHO_CONTRACT = '0xecdbe2af33e68cf96f6716f706b078fa94e978cb' // MetaMorphoV1_1 контракт
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

// ABI для MetaMorphoV1_1 контракта (основные функции)
const METAMORPHO_ABI = [
  {
    'inputs': [
      { 'internalType': 'uint256', 'name': 'assets', 'type': 'uint256' },
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' }
    ],
    'name': 'deposit',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'shares', 'type': 'uint256' }
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
      { 'internalType': 'uint256', 'name': 'assets', 'type': 'uint256' }
    ],
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
    'name': 'totalAssets',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'totalSupply',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'asset',
    'outputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
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
 * Получает баланс токенов ликвидности Morpho для указанного адреса
 */
export async function getMorphoBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'balanceOf',
      args: [address]
    })

    const decimals = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'decimals'
    })

    return formatUnits(balance, decimals)
  } catch (error) {
    logger.error('Ошибка при получении баланса токенов ликвидности Morpho', error)
    throw error
  }
}

/**
 * Проверяет allowance (разрешение) для MetaMorpho контракта
 */
export async function checkAllowance (owner: `0x${string}`, amount: string): Promise<boolean> {
  try {
    const allowance = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, METAMORPHO_CONTRACT]
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
 * Выполняет approve для MetaMorpho контракта на указанную сумму
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
      args: [METAMORPHO_CONTRACT, amountWei],
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
        args: [METAMORPHO_CONTRACT, amountWei],
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
      logger.transaction(hash, 'confirmed', 'MORPHO', account.address)
      await new Promise(resolve => setTimeout(resolve, 30000))
    } else {
      throw new Error('Approve transaction failed')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении approve', error)
    throw error
  }
}

/**
 * Добавляет ликвидность в Morpho (deposit)
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

    // Добавляем ликвидность

    // Добавляем ликвидность с увеличенным лимитом газа
    let hash: `0x${string}`
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>

    try {
      // Получаем рекомендуемый лимит газа и увеличиваем на 50%
      const estimatedGas = await publicClient.estimateContractGas({
        address: METAMORPHO_CONTRACT,
        abi: METAMORPHO_ABI,
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
          address: METAMORPHO_CONTRACT,
          abi: METAMORPHO_ABI,
          functionName: 'deposit',
          args: [amountWei, account.address], // assets, receiver
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
            address: METAMORPHO_CONTRACT,
            abi: METAMORPHO_ABI,
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
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении депозита', error)
    throw error
  }
}

/**
 * Выводит ликвидность (redeem) из Morpho
 */
export async function redeem (privateKey: `0x${string}`, amount: string | null = null): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Получаем текущий баланс токенов ликвидности
    const morphoBalance = await getMorphoBalance(account.address)

    if (parseFloat(morphoBalance) === 0) {
      throw new Error('Нет токенов ликвидности для вывода')
    }

    // Определяем количество для вывода
    const redeemAmount = amount || morphoBalance
    if (parseFloat(redeemAmount) > parseFloat(morphoBalance)) {
      throw new Error('Недостаточно токенов ликвидности для указанной суммы')
    }

    const decimals = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(redeemAmount, decimals)

    // Выводим ликвидность

    // Выводим ликвидность с увеличенным лимитом газа
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
          address: METAMORPHO_CONTRACT,
          abi: METAMORPHO_ABI,
          functionName: 'redeem',
          args: [amountWei, account.address, account.address], // shares, receiver, owner
          gas: 500000n // Увеличенный лимит газа для сложной операции Morpho
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
            address: METAMORPHO_CONTRACT,
            abi: METAMORPHO_ABI,
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
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выводе ликвидности', error)
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
 * Получает общий supply токенов ликвидности Morpho
 */
export async function getMorphoTotalSupply (): Promise<string> {
  try {
    const totalSupply = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'totalSupply'
    })

    const decimals = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'decimals'
    })

    return formatUnits(totalSupply, decimals)
  } catch (error) {
    logger.error('Ошибка при получении общего supply токенов ликвидности', error)
    throw error
  }
}

/**
 * Получает общие активы Morpho
 */
export async function getMorphoTotalAssets (): Promise<string> {
  try {
    const totalAssets = await publicClient.readContract({
      address: METAMORPHO_CONTRACT,
      abi: METAMORPHO_ABI,
      functionName: 'totalAssets'
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(totalAssets, decimals)
  } catch (error) {
    logger.error('Ошибка при получении общих активов Morpho', error)
    throw error
  }
}

/**
 * Выводит детальную информацию о ликвидности
 */
export async function displayLiquidityInfo (_userAddress: `0x${string}`, _operation: string, _amount: string, _transactionHash: string): Promise<void> {}

/**
 * Полный процесс управления ликвидностью Morpho с проверками
 */
export async function performMorphoLiquidityManagement (privateKey: `0x${string}`, amount: string | null = null): Promise<{
  success: boolean
  walletAddress?: string
  usdcBalance?: string
  morphoBalance?: string
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
    logger.info(`[Morpho] Кошелек: ${account.address}`)

    // 1. Проверяем текущую ликвидность (токены ликвидности)
    const morphoBalance = await getMorphoBalance(account.address)

    // 2. Если есть токены ликвидности, выводим их
    if (parseFloat(morphoBalance) > 0) {
      logger.info('[Morpho] Обнаружена ликвидность, вывод...')
      const withdrawTxHash = await redeem(privateKey)

      // Выводим информацию после вывода
      await displayLiquidityInfo(account.address, 'redeem', morphoBalance, withdrawTxHash)

      return {
        success: true,
        walletAddress: account.address,
        morphoBalance: morphoBalance,
        withdrawTransactionHash: withdrawTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${withdrawTxHash}`
      }
    } else {
      // 3. Проверяем и обеспечиваем наличие USDC.e для депозита
      const usdcBalanceResult = await ensureUSDCBalance(privateKey, '0.0001')

      if (!usdcBalanceResult.success) {
        throw new Error(`Не удалось обеспечить наличие USDC.e: ${usdcBalanceResult.error}`)
      }

      const usdcBalance = usdcBalanceResult.usdcBalance

      // 4. Определяем количество для депозита
      const depositAmount = amount || usdcBalance
      if (parseFloat(depositAmount) > parseFloat(usdcBalance)) {
        throw new Error('Недостаточно USDC.e на балансе для указанной суммы')
      }

      logger.info(`[Morpho] Депозит: ${depositAmount} USDC.e`)

      // 5. Проверяем allowance
      const hasAllowance = await checkAllowance(account.address, depositAmount)

      // 6. Если нужно, выполняем approve
      if (!hasAllowance) {
        await approveUSDC(privateKey, depositAmount)
      }

      // 7. Добавляем ликвидность
      const depositTxHash = await deposit(privateKey, depositAmount)

      // 8. Выводим детальную информацию после депозита
      await displayLiquidityInfo(account.address, 'deposit', depositAmount, depositTxHash)

      return {
        success: true,
        walletAddress: account.address,
        usdcBalance: usdcBalance,
        morphoBalance: morphoBalance,
        depositAmount: depositAmount,
        depositTransactionHash: depositTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${depositTxHash}`,
        usdcPurchased: usdcBalanceResult.purchased || false,
        usdcPurchaseHash: usdcBalanceResult.purchaseHash || undefined,
        usdcPurchaseAmount: usdcBalanceResult.purchaseAmount || undefined
      }
    }

  } catch (error) {
    logger.error('Ошибка при управлении ликвидностью Morpho', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка'
    }
  }
}

// Экспорт констант для использования в других модулях
export {
  METAMORPHO_CONTRACT,
  USDC_E_TOKEN,
  ERC20_ABI,
  METAMORPHO_ABI
}
