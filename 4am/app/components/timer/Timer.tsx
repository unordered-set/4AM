"use client"

import "./timer.css";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { WalletButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { formatUnits, parseAbi, parseEther, parseUnits } from "viem";
import { useAccount, useChainId, useContractWrite, usePrepareContractWrite, useSendTransaction, useWaitForTransaction } from "wagmi";
import { multicall } from "wagmi/actions";

const saleContractAddress = "0x277bFD5b92cda825783319fCDBA6e637Dc181021";

interface CurrencyInfo {
    address: `0x${string}`,
    decimals: number,
    balance: bigint,
    approvedAmount: bigint,
}

const formatAmount = (i: CurrencyInfo): string => {
    if (i.balance === BigInt("0")) { return ""; }
    let fullAmount = formatUnits(i.balance, i.decimals);
    const dotIndex = fullAmount.indexOf(".");
    if (dotIndex >= 0) {
        fullAmount = fullAmount.substring(0, dotIndex + 3);
    }
    while (fullAmount.length < dotIndex + 3) {
        fullAmount = fullAmount.concat("0");
    }
    return " " + fullAmount;
}

const SALES_ABI = parseAbi([
    "function buy(address currency, uint256 amount)"
]);
const TOKEN_ABI = parseAbi([
    "function balanceOf(address owner) returns (uint256)",
    "function allowance(address owner, address spender) returns (uint256)",
    "function approve(address spender, uint256 amount)",
]);

export default function Timer() {
    const [amountToSpend, setAmountToSpend] = useState("1000.0")
    const [currency, setCurrency] = useState<"USDT" | "USDC">("USDC");
    const [currencyInfos, setCurrencyInfos] = useState<CurrencyInfo[]>([
        { "address": "0x6f4948c484f6dEfC986c136562D98dfB3280EC18", "decimals": 18, "balance": BigInt("0"), "approvedAmount": BigInt("0") },
        { "address": "0x1E44331ca731aFb1DA8A4B75a9f5E32199b15942", "decimals": 18, "balance": BigInt("0"), "approvedAmount": BigInt("0") },
    ]);
    const [isAmountOK, setIsAmountOK] = useState(true);
    const [parsedAmount, setParsedAmount] = useState(BigInt("1000000000"));

    const account = useAccount();
    const chainId = useChainId();

    const [transitionState, setTransitionState] = useState<"not-started" | "approving" | "approved" | "buying" | "bought">("not-started");
    const [approvalTxHash, setApprovalTxHash] = useState<undefined | `0x${string}`>();
    const [purchaseTxHash, setPurchaseTxHash] = useState<undefined | `0x${string}`>();

    useEffect(() => {
        if (!account.address) return;
        multicall({
            chainId,
            contracts: [
                {
                    abi: TOKEN_ABI,
                    address: currencyInfos[0].address,
                    functionName: "balanceOf",
                    args: [account.address]
                },
                {
                    abi: TOKEN_ABI,
                    address: currencyInfos[1].address,
                    functionName: "balanceOf",
                    args: [account.address]
                },
                {
                    abi: TOKEN_ABI,
                    address: currencyInfos[0].address,
                    functionName: "allowance",
                    args: [account.address, saleContractAddress],
                },
                {
                    abi: TOKEN_ABI,
                    address: currencyInfos[1].address,
                    functionName: "allowance",
                    args: [account.address, saleContractAddress],
                },
            ],
        }).then(((accountAddressAtRequest, chainIdAtRequest) => {
            if (account.address !== accountAddressAtRequest || chainId !== chainIdAtRequest)
                return;
            return (result) => {
                const newCurrencyInfos = [
                    Object.assign({}, currencyInfos[0]),
                    Object.assign({}, currencyInfos[1]),
                ];
                if (result[0].status === "success") {
                    newCurrencyInfos[0].balance = result[0].result;
                }
                if (result[1].status === "success") {
                    newCurrencyInfos[1].balance = result[1].result;
                }
                if (result[2].status === "success") {
                    newCurrencyInfos[0].approvedAmount = result[2].result;
                }
                if (result[3].status === "success") {
                    newCurrencyInfos[1].approvedAmount = result[3].result;
                }
                setCurrencyInfos(newCurrencyInfos);
            }
        })(account.address, chainId))
    }, [account.address, chainId]);

    useEffect(() => {
        try {
            const r = parseUnits(amountToSpend, currencyInfos[currency === "USDT" ? 0 : 1].decimals);
            setIsAmountOK(true);
            setParsedAmount(r);
        } catch (e) {
            setIsAmountOK(false);
        }
    }, [amountToSpend, currency]);

    useEffect(() => {
        if (!isAmountOK) return;
        const approvedAmount = currencyInfos[currency === "USDT" ? 0 : 1].approvedAmount;
        if (approvedAmount >= parsedAmount && transitionState === "not-started") {
            setTransitionState("approved");
        }
        if (approvedAmount < parsedAmount && transitionState === "approved") {
            setTransitionState("not-started");
        }
    }, [currency, isAmountOK, parsedAmount, currencyInfos]);

    const prepareApprove = usePrepareContractWrite({
        address: currencyInfos[currency === "USDT" ? 0 : 1].address,
        abi: TOKEN_ABI,
        functionName: "approve",
        chainId,
        args: [
            saleContractAddress,
            parsedAmount,
        ],
        enabled: isAmountOK && !!account && transitionState === "not-started"
    })
    const approveAction = useContractWrite(prepareApprove.config);
    const approvalIsReady = useWaitForTransaction({
        hash: approvalTxHash,
        enabled: !!approvalTxHash,
        timeout: 999999,
    })

    const preparedBuy = usePrepareContractWrite({
        address: saleContractAddress,
        abi: SALES_ABI,
        functionName: "buy",
        chainId,
        args: [
            currencyInfos[currency === "USDT" ? 0 : 1].address,
            parsedAmount,
        ],
        enabled: isAmountOK && !!account &&
            (transitionState === "approved" || (transitionState === "approving" && approvalIsReady.status === "success"))
    })
    const buyAction = useContractWrite(preparedBuy.config);
    const purchaseIsReady = useWaitForTransaction({
        hash: purchaseTxHash,
        enabled: !!purchaseTxHash,
        timeout: 999999,
    })

    // Обработчики событий для изменения стиля при нажатии на кнопки
    const handleUSDTButtonClick = () => {
        setCurrency("USDT");
        document.getElementById('usdtButton')?.classList.add('selected-currency');
        document.getElementById('usdcButton')?.classList.remove('selected-currency');
    };

    const handleUSDCButtonClick = () => {
        setCurrency("USDC");
        document.getElementById('usdcButton')?.classList.add('selected-currency');
        document.getElementById('usdtButton')?.classList.remove('selected-currency');
    };

    return (
        <section className="Timer" id='presale'>
            <div className="timer__conteiner">
                <div className="timer__info">
                    <h1 className="timer__info-title">Become a Part<br />of Revolution Now</h1>
                    <p className="timer__info-text">Introducing the AXXIS Token: your gateway to an exclusive digital fashion marketplace. Seize this presale opportunity to be among the first to access and trade in high-end fashion NFTs, revolutionizing how luxury is owned and experienced</p>
                </div>
                <div className="timer__content">
                    <div className="timer__price">
                        <p className="timer__price1">Current price</p>
                        <p className="timer__price2">0.01$</p>
                    </div>
                    <div className="timer__manual">
                        <h2 className="timer__manual_title">How to participate?</h2>
                        <ol className="timer__manual_list">
                            <li className="timer__manual_listpoint">Deposit some ETH for gas fees and enough USDC/USDT on your CEX/Metamask wallet</li>
                            <li className="timer__manual_listpoint">Press "Connect" button below</li>
                            <li className="timer__manual_listpoint">Specify the amount and currency</li>
                            <li className="timer__manual_listpoint">Receive $AXXIS by $0.01 ratio</li>
                        </ol>
                    </div>
                    {/* <div>{transitionState} {parsedAmount.toString()}</div>
                    <div>{approvalTxHash} {approvalIsReady.fetchStatus} st={approvalIsReady.status}
                        suc={approvalIsReady.isSuccess} 
                    </div> */}
                    <div className="timer__clock">
                        <h2 className="timer__clock_title">Until presale end</h2>
                        <div className="timer__clock_nums">
                            <div className="timer__clock_num">
                                <h2 className="timer__clock_num-up">00</h2>
                                <h2 className="timer__clock_num-down">Days</h2>
                            </div>
                            <p className="timer__clock_nums_dots">:</p>
                            <div className="timer__clock_num">
                                <h2 className="timer__clock_num-up">00</h2>
                                <h2 className="timer__clock_num-down">Hours</h2>
                            </div>
                            <p className="timer__clock_nums_dots">:</p>
                            <div className="timer__clock_num">
                                <h2 className="timer__clock_num-up">00</h2>
                                <h2 className="timer__clock_num-down">Minutes</h2>
                            </div>
                            <p className="timer__clock_nums_dots">:</p>
                            <div className="timer__clock_num">
                                <h2 className="timer__clock_num-up">00</h2>
                                <h2 className="timer__clock_num-down">Seconds</h2>
                            </div>
                        </div>
                        <div className="timer__clock_timelineblock">
                            <div className="timer__clock_timeline">
                                <div className="timer__clock_timeline-dot"></div>
                            </div>
                            <div className="timer__clock_percents">
                                <p className="timer__clock_percent0">0%</p>
                                <p className="timer__clock_percent100">100%</p>
                            </div>
                        </div>
                    </div>
                    <div className="timer__web3">
                        <div className="timer__web3_connect">
                            <ConnectButton
                                label="CONNECT"
                                chainStatus="icon"
                                accountStatus={{
                                    smallScreen: "full",
                                    largeScreen: "full",
                                }}
                                showBalance={{
                                    smallScreen: false,
                                    largeScreen: true,
                                }}
                            />
                        </div>
                        <div className="timer__web3_buy">
                            <input type="text" placeholder='1000' value={amountToSpend}
                                onChange={e => setAmountToSpend(e.target.value)}></input>
                            <button id="usdtButton" className={`currency-button${currency === "USDT" ? " selected-currency" : ""}`}
                                onClick={handleUSDTButtonClick}>USDT{formatAmount(currencyInfos[0])}</button>
                            <button id="usdcButton" className={`currency-button${currency === "USDC" ? " selected-currency" : ""}`}
                                onClick={handleUSDCButtonClick}>USDC{formatAmount(currencyInfos[1])}</button>
                        </div>
                        <div className="timer__web3_buybtn">
                            {transitionState === "not-started" &&
                                <button onClick={async () => {
                                    console.log(approveAction);
                                    if (approveAction.writeAsync) {
                                        setTransitionState("approving");
                                        try {
                                            const txHash = await approveAction.writeAsync();
                                            setApprovalTxHash(txHash.hash);
                                        } catch (e) {
                                            console.error(e)
                                            setTransitionState("not-started");
                                        }
                                    }
                                }
                                } disabled={approveAction.isError}>Approve</button>
                            }
                            {transitionState === "approving" && approvalIsReady.status === "loading" && <button>Approving...</button>}
                            {(transitionState === "approved" ||
                                (transitionState === "approving" && approvalIsReady.status === "success")) &&
                                <button onClick={async () => {
                                    console.log(buyAction)
                                    if (buyAction.writeAsync) {
                                        setTransitionState("buying");
                                        try {
                                            const txHash = await buyAction.writeAsync();
                                            setPurchaseTxHash(txHash.hash);
                                            const newCurrencyInfos = [
                                                Object.assign({}, currencyInfos[0]),
                                                Object.assign({}, currencyInfos[1]),
                                            ];
                                            const idx = currency === "USDT" ? 0 : 1;
                                            newCurrencyInfos[idx].balance -= parsedAmount;
                                            newCurrencyInfos[idx].approvedAmount -= parsedAmount;
                                            setCurrencyInfos(newCurrencyInfos);
                                        } catch (e) {
                                            console.error(e)
                                            setTransitionState("approved");
                                        }
                                    }
                                }
                                } disabled={buyAction.isError}>Buy!</button>
                            }
                            {transitionState === "buying" && purchaseIsReady.status === "loading" && <button>Buying...</button>}
                            {(transitionState === "buying" && purchaseIsReady.status === "success") && "Purchase completed!"}
                        </div>
                    </div>
                </div>
            </div>
        </section >
    );
}

