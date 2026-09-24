// ABIs for the deployed Pons V2 contracts on Robinhood Chain, trimmed to what musestream uses.
// Factory and fee escrow: verified sources on Sourcify (chain 4663).
// Bonding curve: compiled from github.com/ponsdotdev/pons-labs and checked selector by selector
// against the bytecode of a deployed curve, because curves are created by the factory unverified.

export const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as const;
/** config 0: 1B supply, 1% curve fee, graduates at 4.2 ETH of real quote */
export const PONS_LAUNCH_CONFIG = 0n;
/** the zero address as pair token means the curve trades native ETH */
export const NATIVE_PAIR = '0x0000000000000000000000000000000000000000' as const;

export const factoryAbi = [
	{
		name: 'getLaunchFeePolicy',
		type: 'function',
		inputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{
						name: 'protocolFeeRecipient',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'protocolFeeShareBps',
						type: 'uint16',
						internalType: 'uint16'
					},
					{
						name: 'buybackBurnBps',
						type: 'uint16',
						internalType: 'uint16'
					},
					{
						name: 'hookFeeBps',
						type: 'uint16',
						internalType: 'uint16'
					},
					{
						name: 'maxInternalPriceImpactBps',
						type: 'uint16',
						internalType: 'uint16'
					}
				],
				internalType: 'struct FeePolicySnapshot'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'PoolGraduated',
		type: 'event',
		inputs: [
			{
				name: 'token',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'positionId',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'tokenAmount',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'pairTokenAmount',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		name: 'TokenLaunched',
		type: 'event',
		inputs: [
			{
				name: 'token',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'curve',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'deployer',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'pairToken',
				type: 'address',
				indexed: false,
				internalType: 'address'
			},
			{
				name: 'launchConfigId',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'graduationThreshold',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		name: 'feeEscrow',
		type: 'function',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'address',
				internalType: 'contract IPonsV2FeeEscrow'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'getLaunchConfig',
		type: 'function',
		inputs: [
			{
				name: 'id',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{
						name: 'supply',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'curveFeeBps',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'phantomQuote',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'graduationThreshold',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'poolFee',
						type: 'uint24',
						internalType: 'uint24'
					},
					{
						name: 'tickSpacing',
						type: 'int24',
						internalType: 'int24'
					},
					{
						name: 'enabled',
						type: 'bool',
						internalType: 'bool'
					}
				],
				internalType: 'struct PonsV2LaunchFactory.LaunchConfig'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'getLaunchedToken',
		type: 'function',
		inputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{
						name: 'token',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'curve',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'deployer',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'creatorFeeRecipient',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'pairToken',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'graduationThreshold',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'poolFee',
						type: 'uint24',
						internalType: 'uint24'
					},
					{
						name: 'tickSpacing',
						type: 'int24',
						internalType: 'int24'
					},
					{
						name: 'creatorTaxBps',
						type: 'uint16',
						internalType: 'uint16'
					},
					{
						name: 'buybackEnabled',
						type: 'bool',
						internalType: 'bool'
					},
					{
						name: 'phase',
						type: 'uint8',
						internalType: 'enum GraduationPhase'
					},
					{
						name: 'sweptQuote',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'sweptTokens',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'sweptAt',
						type: 'uint256',
						internalType: 'uint256'
					},
					{
						name: 'exists',
						type: 'bool',
						internalType: 'bool'
					}
				],
				internalType: 'struct IPonsV2LaunchFactory.LaunchedToken'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'launchEnabled',
		type: 'function',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'bool',
				internalType: 'bool'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'launchFee',
		type: 'function',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'launchToken',
		type: 'function',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{
						name: 'name',
						type: 'string',
						internalType: 'string'
					},
					{
						name: 'symbol',
						type: 'string',
						internalType: 'string'
					},
					{
						name: 'logo',
						type: 'string',
						internalType: 'string'
					},
					{
						name: 'description',
						type: 'string',
						internalType: 'string'
					},
					{
						name: 'socials',
						type: 'tuple',
						components: [
							{
								name: 'twitter',
								type: 'string',
								internalType: 'string'
							},
							{
								name: 'telegram',
								type: 'string',
								internalType: 'string'
							},
							{
								name: 'discord',
								type: 'string',
								internalType: 'string'
							},
							{
								name: 'website',
								type: 'string',
								internalType: 'string'
							},
							{
								name: 'farcaster',
								type: 'string',
								internalType: 'string'
							}
						],
						internalType: 'struct PonsV2LauncherToken.Socials'
					},
					{
						name: 'creatorFeeRecipient',
						type: 'address',
						internalType: 'address'
					},
					{
						name: 'creatorTaxBps',
						type: 'uint16',
						internalType: 'uint16'
					},
					{
						name: 'buybackEnabled',
						type: 'bool',
						internalType: 'bool'
					},
					{
						name: 'expectedEconomics',
						type: 'bytes32',
						internalType: 'bytes32'
					},
					{
						name: 'salt',
						type: 'bytes32',
						internalType: 'bytes32'
					}
				],
				internalType: 'struct PonsV2LaunchFactory.TokenParams'
			},
			{
				name: 'launchConfigId',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'pairToken',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			},
			{
				name: 'curve',
				type: 'address',
				internalType: 'address'
			}
		],
		stateMutability: 'payable'
	},
	{
		name: 'previewLaunchEconomics',
		type: 'function',
		inputs: [
			{
				name: 'launchConfigId',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'pairToken',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: '',
				type: 'bytes32',
				internalType: 'bytes32'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'AlreadySet',
		type: 'error',
		inputs: []
	},
	{
		name: 'CombinedFeeTooHigh',
		type: 'error',
		inputs: []
	},
	{
		name: 'CoreLpFeeMustBeZero',
		type: 'error',
		inputs: []
	},
	{
		name: 'CreatorTaxTooHigh',
		type: 'error',
		inputs: []
	},
	{
		name: 'CurveFeeTooHigh',
		type: 'error',
		inputs: []
	},
	{
		name: 'CurveNotQuotable',
		type: 'error',
		inputs: []
	},
	{
		name: 'ExemptionListTooLong',
		type: 'error',
		inputs: []
	},
	{
		name: 'FeeTransferFailed',
		type: 'error',
		inputs: []
	},
	{
		name: 'GraduationExecutorNotSet',
		type: 'error',
		inputs: []
	},
	{
		name: 'GraduationRescueTooEarly',
		type: 'error',
		inputs: [
			{
				name: 'availableAt',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		name: 'GraduationSeedNotViable',
		type: 'error',
		inputs: []
	},
	{
		name: 'GraduationStillViable',
		type: 'error',
		inputs: []
	},
	{
		name: 'InexactTransfer',
		type: 'error',
		inputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			},
			{
				name: 'expected',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'received',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		name: 'InvalidBasisPoints',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidGraduationThreshold',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidLaunchConfigId',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidPhantomQuote',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidSnipeTaxWindow',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidTickSpacing',
		type: 'error',
		inputs: []
	},
	{
		name: 'InvalidTokenParams',
		type: 'error',
		inputs: []
	},
	{
		name: 'LaunchConfigDisabled',
		type: 'error',
		inputs: []
	},
	{
		name: 'LaunchDependenciesNotWired',
		type: 'error',
		inputs: []
	},
	{
		name: 'LaunchDeployerNotSet',
		type: 'error',
		inputs: []
	},
	{
		name: 'LaunchEconomicsMismatch',
		type: 'error',
		inputs: [
			{
				name: 'expected',
				type: 'bytes32',
				internalType: 'bytes32'
			},
			{
				name: 'actual',
				type: 'bytes32',
				internalType: 'bytes32'
			}
		]
	},
	{
		name: 'LaunchFeeNotPaid',
		type: 'error',
		inputs: []
	},
	{
		name: 'NoPendingChange',
		type: 'error',
		inputs: []
	},
	{
		name: 'NotBuybackController',
		type: 'error',
		inputs: []
	},
	{
		name: 'NotCreatorFeeRecipient',
		type: 'error',
		inputs: []
	},
	{
		name: 'NotLaunchForwarder',
		type: 'error',
		inputs: []
	},
	{
		name: 'NotReadyToGraduate',
		type: 'error',
		inputs: []
	},
	{
		name: 'NotWhitelisted',
		type: 'error',
		inputs: []
	},
	{
		name: 'NothingToGraduate',
		type: 'error',
		inputs: []
	},
	{
		name: 'OwnableInvalidOwner',
		type: 'error',
		inputs: [
			{
				name: 'owner',
				type: 'address',
				internalType: 'address'
			}
		]
	},
	{
		name: 'OwnableUnauthorizedAccount',
		type: 'error',
		inputs: [
			{
				name: 'account',
				type: 'address',
				internalType: 'address'
			}
		]
	},
	{
		name: 'OwnershipCannotBeRenounced',
		type: 'error',
		inputs: []
	},
	{
		name: 'PairTokenDecimalsMismatch',
		type: 'error',
		inputs: [
			{
				name: 'expected',
				type: 'uint8',
				internalType: 'uint8'
			},
			{
				name: 'actual',
				type: 'uint8',
				internalType: 'uint8'
			}
		]
	},
	{
		name: 'PairTokenDecimalsUnavailable',
		type: 'error',
		inputs: []
	},
	{
		name: 'PairTokenEconomicsInvalid',
		type: 'error',
		inputs: []
	},
	{
		name: 'PairTokenNotApproved',
		type: 'error',
		inputs: []
	},
	{
		name: 'PairTokenValidationFailed',
		type: 'error',
		inputs: []
	},
	{
		name: 'ReentrancyGuardReentrantCall',
		type: 'error',
		inputs: []
	},
	{
		name: 'SafeERC20FailedOperation',
		type: 'error',
		inputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			}
		]
	},
	{
		name: 'SqrtPriceOutOfBounds',
		type: 'error',
		inputs: []
	},
	{
		name: 'SupplyTooHigh',
		type: 'error',
		inputs: []
	},
	{
		name: 'SupplyTooLow',
		type: 'error',
		inputs: []
	},
	{
		name: 'TimelockExpired',
		type: 'error',
		inputs: [
			{
				name: 'expiresAt',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		name: 'TimelockNotElapsed',
		type: 'error',
		inputs: [
			{
				name: 'effectiveAt',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		name: 'TokenNotFound',
		type: 'error',
		inputs: []
	},
	{
		name: 'UnsupportedPrice',
		type: 'error',
		inputs: []
	},
	{
		name: 'WrongGraduationPhase',
		type: 'error',
		inputs: []
	},
	{
		name: 'ZeroAddress',
		type: 'error',
		inputs: []
	},
	{
		name: 'ZeroAmount',
		type: 'error',
		inputs: []
	}
] as const;

export const curveAbi = [
	{
		type: 'function',
		name: 'feeBps',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'protocolFeeShareBps',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint16',
				internalType: 'uint16'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'buy',
		inputs: [
			{
				name: 'quoteIn',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'minTokensOut',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'recipient',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: 'tokensOut',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'payable'
	},
	{
		type: 'function',
		name: 'getReserves',
		inputs: [],
		outputs: [
			{
				name: 'quoteReserve_',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'tokenReserve_',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'graduated',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'bool',
				internalType: 'bool'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'graduationThreshold',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'quoteFeeBalance',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'readyToGraduate',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'bool',
				internalType: 'bool'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'realQuoteReserve',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'sell',
		inputs: [
			{
				name: 'tokensIn',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'minQuoteOut',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'recipient',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: 'quoteOut',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'sellableTokens',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'sweepFees',
		inputs: [
			{
				name: 'minBuybackTokensOut',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		outputs: [],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'token',
		inputs: [],
		outputs: [
			{
				name: '',
				type: 'address',
				internalType: 'address'
			}
		],
		stateMutability: 'view'
	},
	{
		type: 'event',
		name: 'CurveBuy',
		inputs: [
			{
				name: 'buyer',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'recipient',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'quoteIn',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'tokensOut',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'fee',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'tax',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		type: 'event',
		name: 'CurveCompleted',
		inputs: [
			{
				name: 'recipient',
				type: 'address',
				indexed: false,
				internalType: 'address'
			},
			{
				name: 'quoteOut',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'tokenOut',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		type: 'event',
		name: 'CurveSell',
		inputs: [
			{
				name: 'seller',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'recipient',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'tokensIn',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'quoteOut',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'fee',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			},
			{
				name: 'tax',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		type: 'error',
		name: 'AlreadyGraduated',
		inputs: []
	},
	{
		type: 'error',
		name: 'AlreadyInitialized',
		inputs: []
	},
	{
		type: 'error',
		name: 'CurveGraduated',
		inputs: []
	},
	{
		type: 'error',
		name: 'InsufficientInputAmount',
		inputs: []
	},
	{
		type: 'error',
		name: 'InsufficientLiquidity',
		inputs: []
	},
	{
		type: 'error',
		name: 'InsufficientOutputAmount',
		inputs: []
	},
	{
		type: 'error',
		name: 'InternalSwapRequiresOperator',
		inputs: []
	},
	{
		type: 'error',
		name: 'InvalidFeePolicy',
		inputs: []
	},
	{
		type: 'error',
		name: 'InvalidLaunchEconomics',
		inputs: []
	},
	{
		type: 'error',
		name: 'MinimumOutputRequired',
		inputs: []
	},
	{
		type: 'error',
		name: 'NativeValueMismatch',
		inputs: [
			{
				name: 'supplied',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'expected',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		type: 'error',
		name: 'NotFactory',
		inputs: []
	},
	{
		type: 'error',
		name: 'NotFeeSweepOperator',
		inputs: []
	},
	{
		type: 'error',
		name: 'NotInitialized',
		inputs: []
	},
	{
		type: 'error',
		name: 'NotReadyToGraduate',
		inputs: []
	},
	{
		type: 'error',
		name: 'ReentrancyGuardReentrantCall',
		inputs: []
	},
	{
		type: 'error',
		name: 'SafeERC20FailedOperation',
		inputs: [
			{
				name: 'token',
				type: 'address',
				internalType: 'address'
			}
		]
	},
	{
		type: 'error',
		name: 'SlippageExceeded',
		inputs: [
			{
				name: 'actual',
				type: 'uint256',
				internalType: 'uint256'
			},
			{
				name: 'minimum',
				type: 'uint256',
				internalType: 'uint256'
			}
		]
	},
	{
		type: 'error',
		name: 'TransferFailed',
		inputs: []
	},
	{
		type: 'error',
		name: 'UnexpectedNativeValue',
		inputs: []
	},
	{
		type: 'error',
		name: 'ZeroAddress',
		inputs: []
	},
	{
		type: 'error',
		name: 'ZeroAmount',
		inputs: []
	}
] as const;

export const escrowAbi = [
	{
		name: 'Claimed',
		type: 'event',
		inputs: [
			{
				name: 'recipient',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'amount',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		name: 'Credited',
		type: 'event',
		inputs: [
			{
				name: 'recipient',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'depositor',
				type: 'address',
				indexed: true,
				internalType: 'address'
			},
			{
				name: 'amount',
				type: 'uint256',
				indexed: false,
				internalType: 'uint256'
			}
		],
		anonymous: false
	},
	{
		name: 'balanceOf',
		type: 'function',
		inputs: [
			{
				name: 'recipient',
				type: 'address',
				internalType: 'address'
			}
		],
		outputs: [
			{
				name: '',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'view'
	},
	{
		name: 'claim',
		type: 'function',
		inputs: [],
		outputs: [
			{
				name: 'amount',
				type: 'uint256',
				internalType: 'uint256'
			}
		],
		stateMutability: 'nonpayable'
	}
] as const;

/**
 * Graduation's second step: after a curve's reserves are swept, anyone may seed the
 * Uniswap V4 pool with them. Pons runs a keeper for it; musestream calls it too, so a coin
 * never waits. Retryable: the launch stays swept until a seed succeeds.
 */
export const graduationAbi = [
	{
		type: 'function',
		name: 'createGraduatedPool',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'token', type: 'address' }],
		outputs: [{ name: 'positionId', type: 'uint256' }]
	}
] as const;
