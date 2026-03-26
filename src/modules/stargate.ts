import { formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ensureUSDCBalance } from '../usdc-balance-manager.js'
import { rpcManager, soneiumChain } from '../rpc-manager.js'
import { safeWriteContract } from '../transaction-utils.js'
import { logger } from '../logger.js'

// Адреса контрактов Stargate
const STARGATE_POOL_USDC = '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B' // StargatePoolUSDC контракт
const LP_TOKEN = '0x5b091dc6f94b5e2b54edab3800759abf0ed7d26d' // LPToken контракт
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

// ABI для StargatePoolUSDC контракта
const STARGATE_ABI = [
  {
    'inputs': [
      { 'internalType': 'address', 'name': '_receiver', 'type': 'address' },
      { 'internalType': 'uint256', 'name': '_amountLD', 'type': 'uint256' }
    ],
    'name': 'deposit',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'amountLD', 'type': 'uint256' }
    ],
    'stateMutability': 'payable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'uint256', 'name': '_amountLD', 'type': 'uint256' },
      { 'internalType': 'address', 'name': '_receiver', 'type': 'address' }
    ],
    'name': 'redeem',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'amountLD', 'type': 'uint256' }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '_owner', 'type': 'address' }
    ],
    'name': 'redeemable',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'amountLD', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'poolBalance',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'tvl',
    'outputs': [
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  }
] as const

// ABI для LPToken контракта
const LP_TOKEN_ABI = [
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
    'name': 'totalSupply',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
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
 * Получает баланс LP токенов для указанного адреса
 */
export async function getLPBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: LP_TOKEN,
      abi: LP_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address]
    })

    const decimals = await publicClient.readContract({
      address: LP_TOKEN,
      abi: LP_TOKEN_ABI,
      functionName: 'decimals'
    })

    return formatUnits(balance, decimals)
  } catch (error) {
    logger.error('Ошибка при получении баланса LP токенов', error)
    throw error
  }
}

/**
 * Получает redeemable баланс для указанного адреса
 */
export async function getRedeemableBalance (address: `0x${string}`): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: STARGATE_POOL_USDC,
      abi: STARGATE_ABI,
      functionName: 'redeemable',
      args: [address]
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(balance, decimals)
  } catch (error) {
    logger.error('Ошибка при получении redeemable баланса', error)
    throw error
  }
}

/**
 * Проверяет allowance (разрешение) для Stargate контракта
 */
export async function checkAllowance (owner: `0x${string}`, amount: string): Promise<boolean> {
  try {
    const allowance = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, STARGATE_POOL_USDC]
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
 * Выполняет approve для Stargate контракта на указанную сумму
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
      args: [STARGATE_POOL_USDC, amountWei],
      account: account
    })

    const gasLimit = BigInt(Math.floor(Number(estimatedGas) * 1.5))

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
        args: [STARGATE_POOL_USDC, amountWei],
        gas: gasLimit
      }
    )
    if (!txResult.success) throw new Error(txResult.error)
    const hash = txResult.hash

    logger.transaction(hash, 'sent', 'STARGATE')

    // Ожидаем подтверждения
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      logger.transaction(hash, 'confirmed', 'STARGATE', account.address)
    } else {
      logger.transaction(hash, 'failed', 'STARGATE')
      throw new Error('Approve transaction failed')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при выполнении approve', error)
    throw error
  }
}

/**
 * Добавляет ликвидность в Stargate пул
 */
export async function addLiquidity (privateKey: `0x${string}`, amount: string): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(amount, decimals)

    // Добавляем ликвидность с увеличенным лимитом газа
    let hash: `0x${string}`
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>

    try {
      const txResult = await safeWriteContract(
        publicClient,
        walletClient,
        account.address,
        {
          chain: soneiumChain,
          account: account,
          address: STARGATE_POOL_USDC,
          abi: STARGATE_ABI,
          functionName: 'deposit',
          args: [account.address, amountWei],
          gas: 500000n
        }
      )
      if (!txResult.success) throw new Error(txResult.error)
      hash = txResult.hash
      logger.transaction(hash, 'sent', 'STARGATE')
      receipt = await publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      if (error instanceof Error && error.message.includes('gas')) {
        logger.warn('Ошибка газа, пробуем с увеличенным лимитом...')
        const retryResult = await safeWriteContract(
          publicClient,
          walletClient,
          account.address,
          {
            chain: soneiumChain,
            account: account,
            address: STARGATE_POOL_USDC,
            abi: STARGATE_ABI,
            functionName: 'deposit',
            args: [account.address, amountWei],
            gas: 800000n
          }
        )
        if (!retryResult.success) throw new Error(retryResult.error)
        hash = retryResult.hash
        receipt = await publicClient.waitForTransactionReceipt({ hash })
      } else {
        throw error
      }
    }

    if (receipt.status !== 'success') {
      logger.transaction(hash, 'failed', 'STARGATE')
    }

    return hash
  } catch (error) {
    logger.error('Ошибка при добавлении ликвидности', error)
    throw error
  }
}

/**
 * Выводит ликвидность (redeem) из Stargate пула
 */
export async function redeemLiquidity (privateKey: `0x${string}`, amount: string | null = null): Promise<string> {
  try {
    const account = privateKeyToAccount(privateKey)

    const walletClient = rpcManager.createWalletClient(soneiumChain, account)

    // Получаем текущий redeemable баланс
    const redeemableBalance = await getRedeemableBalance(account.address)

    if (parseFloat(redeemableBalance) === 0) {
      throw new Error('Нет redeemable токенов для вывода')
    }

    // Определяем количество для вывода
    const redeemAmount = amount || redeemableBalance
    if (parseFloat(redeemAmount) > parseFloat(redeemableBalance)) {
      throw new Error('Недостаточно redeemable токенов для указанной суммы')
    }

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    const amountWei = parseUnits(redeemAmount, decimals)

    // Выводим ликвидность с увеличенным лимитом газа
    let hash: `0x${string}`
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>

    try {
      const txResult = await safeWriteContract(
        publicClient,
        walletClient,
        account.address,
        {
          chain: soneiumChain,
          account: account,
          address: STARGATE_POOL_USDC,
          abi: STARGATE_ABI,
          functionName: 'redeem',
          args: [amountWei, account.address],
          gas: 500000n
        }
      )
      if (!txResult.success) throw new Error(txResult.error)
      hash = txResult.hash
      logger.transaction(hash, 'sent', 'STARGATE')
      receipt = await publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      if (error instanceof Error && error.message.includes('gas')) {
        logger.warn('Ошибка газа, пробуем с увеличенным лимитом...')
        const retryResult = await safeWriteContract(
          publicClient,
          walletClient,
          account.address,
          {
            chain: soneiumChain,
            account: account,
            address: STARGATE_POOL_USDC,
            abi: STARGATE_ABI,
            functionName: 'redeem',
            args: [amountWei, account.address],
            gas: 800000n
          }
        )
        if (!retryResult.success) throw new Error(retryResult.error)
        hash = retryResult.hash
        receipt = await publicClient.waitForTransactionReceipt({ hash })
      } else {
        throw error
      }
    }

    if (receipt.status !== 'success') {
      logger.transaction(hash, 'failed', 'STARGATE')
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
 * Получает общий supply LP токенов
 */
export async function getLPTotalSupply (): Promise<string> {
  try {
    const totalSupply = await publicClient.readContract({
      address: LP_TOKEN,
      abi: LP_TOKEN_ABI,
      functionName: 'totalSupply'
    })

    const decimals = await publicClient.readContract({
      address: LP_TOKEN,
      abi: LP_TOKEN_ABI,
      functionName: 'decimals'
    })

    return formatUnits(totalSupply, decimals)
  } catch (error) {
    logger.error('Ошибка при получении общего supply LP токенов', error)
    throw error
  }
}

/**
 * Получает TVL пула
 */
export async function getPoolTVL (): Promise<string> {
  try {
    const tvl = await publicClient.readContract({
      address: STARGATE_POOL_USDC,
      abi: STARGATE_ABI,
      functionName: 'tvl'
    })

    const decimals = await publicClient.readContract({
      address: USDC_E_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })

    return formatUnits(tvl, decimals)
  } catch (error) {
    logger.error('Ошибка при получении TVL пула', error)
    throw error
  }
}

/**
 * Выводит детальную информацию о ликвидности
 */
export async function displayLiquidityInfo (_userAddress: `0x${string}`, _operation: string, _amount: string, _transactionHash: string): Promise<void> {}

/**
 * Полный процесс управления ликвидностью с проверками
 */
export async function performLiquidityManagement (privateKey: `0x${string}`, amount: string | null = null): Promise<{
  success: boolean
  walletAddress?: string
  usdcBalance?: string
  redeemableBalance?: string
  depositAmount?: string
  depositTransactionHash?: string
  redeemTransactionHash?: string | null
  explorerUrl?: string
  usdcPurchased?: boolean
  usdcPurchaseHash?: string | undefined
  usdcPurchaseAmount?: string | undefined
  error?: string
}> {
  try {
    const account = privateKeyToAccount(privateKey)
    logger.info(`[Stargate] Кошелек: ${account.address}`)

    const redeemableBalance = await getRedeemableBalance(account.address)

    if (parseFloat(redeemableBalance) > 0) {
      logger.info('[Stargate] Вывод ликвидности')
      const redeemTxHash = await redeemLiquidity(privateKey)

      await displayLiquidityInfo(account.address, 'redeem', redeemableBalance, redeemTxHash)

      return {
        success: true,
        walletAddress: account.address,
        redeemableBalance: redeemableBalance,
        redeemTransactionHash: redeemTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${redeemTxHash}`
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

      logger.info(`[Stargate] Депозит: ${depositAmount} USDC.e`)

      const hasAllowance = await checkAllowance(account.address, depositAmount)

      if (!hasAllowance) {
        logger.warn('Недостаточно allowance, выполняем approve...')
        await approveUSDC(privateKey, depositAmount)
      }

      const depositTxHash = await addLiquidity(privateKey, depositAmount)

      await displayLiquidityInfo(account.address, 'deposit', depositAmount, depositTxHash)

      return {
        success: true,
        walletAddress: account.address,
        usdcBalance: usdcBalance,
        redeemableBalance: redeemableBalance,
        depositAmount: depositAmount,
        depositTransactionHash: depositTxHash,
        explorerUrl: `https://soneium.blockscout.com/tx/${depositTxHash}`,
        usdcPurchased: usdcBalanceResult.purchased || false,
        usdcPurchaseHash: usdcBalanceResult.purchaseHash || undefined,
        usdcPurchaseAmount: usdcBalanceResult.purchaseAmount || undefined
      }
    }

  } catch (error) {
    logger.error('Ошибка при управлении ликвидностью', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка'
    }
  }
}

// Экспорт констант для использования в других модулях
export {
  STARGATE_POOL_USDC,
  LP_TOKEN,
  USDC_E_TOKEN,
  ERC20_ABI,
  STARGATE_ABI,
  LP_TOKEN_ABI
}
