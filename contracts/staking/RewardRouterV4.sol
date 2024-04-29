// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IRewardTracker_0_8_18.sol";
import "./interfaces/IRewardRouterV4.sol";
import "./interfaces/IVester_0_8_18.sol";
import "../tokens/interfaces/IMintable_0_8_18.sol";
import "../tokens/interfaces/IWETH_0_8_18.sol";
import "../core/interfaces/IZlpManager_0_8_18.sol";
import "../access/Governable_0_8_18.sol";

contract RewardRouterV4 is IRewardRouterV4, ReentrancyGuard, Governable_0_8_18 {
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;

    address public zke;
    address public esZke;
    address public bnZke;

    address public zlp; // ZKE Liquidity Provider token
    address public degenLP;

    address public stakedZkeTracker;
    address public bonusZkeTracker;
    address public feeZkeTracker;

    address public override stakedZlpTracker;
    address public override feeZlpTracker;

    address public override stakedDegenLPTracker;
    address public override feeDegenLPTracker;

    address public zlpManager;
    address public degenLPManager;

    address public zkeVester;
    address public zlpVester;
    address public degenLPVester;

    mapping (address => address) public pendingReceivers;

    event StakeZke(address account, address token, uint256 amount);
    event UnstakeZke(address account, address token, uint256 amount);

    event StakeZlp(address account, uint256 amount);
    event UnstakeZlp(address account, uint256 amount);

    event StakeDegenLP(address account, uint256 amount);
    event UnstakeDegenLP(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _zke,
        address _esZke,
        address _bnZke,
        address _zlp,
        address _stakedZkeTracker,
        address _bonusZkeTracker,
        address _feeZkeTracker,
        address _feeZlpTracker,
        address _stakedZlpTracker,
        address _zlpManager,
        address _zkeVester,
        address _zlpVester,
        address _degenLP,
        address _feeDegenLPTracker,
        address _stakedDegenLPTracker,
        address _degenLPManager,
        address _degenLPVester
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;

        zke = _zke;
        esZke = _esZke;
        bnZke = _bnZke;

        zlp = _zlp;
        degenLP = _degenLP;

        stakedZkeTracker = _stakedZkeTracker;
        bonusZkeTracker = _bonusZkeTracker;
        feeZkeTracker = _feeZkeTracker;

        feeZlpTracker = _feeZlpTracker;
        stakedZlpTracker = _stakedZlpTracker;

        zlpManager = _zlpManager;

        zkeVester = _zkeVester;
        zlpVester = _zlpVester;


        feeDegenLPTracker = _feeDegenLPTracker;
        stakedDegenLPTracker = _stakedDegenLPTracker;

        degenLPManager = _degenLPManager;

        degenLPVester = _degenLPVester;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function batchStakeZkeForAccount(address[] memory _accounts, uint256[] memory _amounts) external nonReentrant onlyGov {
        address _zke = zke;
        for (uint256 i = 0; i < _accounts.length; i++) {
            _stakeZke(msg.sender, _accounts[i], _zke, _amounts[i]);
        }
    }

    function stakeZkeForAccount(address _account, uint256 _amount) external nonReentrant onlyGov {
        _stakeZke(msg.sender, _account, zke, _amount);
    }

    function stakeZke(uint256 _amount) external nonReentrant {
        _stakeZke(msg.sender, msg.sender, zke, _amount);
    }

    function stakeEsZke(uint256 _amount) external nonReentrant {
        _stakeZke(msg.sender, msg.sender, esZke, _amount);
    }

    function unstakeZke(uint256 _amount) external nonReentrant {
        _unstakeZke(msg.sender, zke, _amount, true);
    }

    function unstakeEsZke(uint256 _amount) external nonReentrant {
        _unstakeZke(msg.sender, esZke, _amount, true);
    }

    function mintAndStakeZlp(address _token, uint256 _amount, uint256 _minUsdg, uint256 _minZlp) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");
        
        address account = msg.sender;
        uint256 zlpAmount = IZlpManager_0_8_18(zlpManager).addLiquidityForAccount(account, account, _token, _amount, _minUsdg, _minZlp);
        IRewardTracker_0_8_18(feeZlpTracker).stakeForAccount(account, account, zlp, zlpAmount);
        IRewardTracker_0_8_18(stakedZlpTracker).stakeForAccount(account, account, feeZlpTracker, zlpAmount);

        emit StakeZlp(account, zlpAmount);

        return zlpAmount;
    }

        function mintAndStakeDegenLP(address _token, uint256 _amount, uint256 _minUsdg, uint256 _minDegenLP) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");
        
        address account = msg.sender;
        uint256 degenLPAmount = IZlpManager_0_8_18(degenLPManager).addLiquidityForAccount(account, account, _token, _amount, _minUsdg, _minDegenLP);
        IRewardTracker_0_8_18(feeDegenLPTracker).stakeForAccount(account, account, degenLP, degenLPAmount);
        IRewardTracker_0_8_18(stakedDegenLPTracker).stakeForAccount(account, account, feeDegenLPTracker, degenLPAmount);

        emit StakeDegenLP(account, degenLPAmount);

        return degenLPAmount;
    }

    function mintAndStakeZlpETH(uint256 _minUsdg, uint256 _minZlp) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");
        uint256 newMsgValue = msg.value;

        IWETH_0_8_18(weth).deposit{value: newMsgValue}();
        IERC20(weth).approve(zlpManager, newMsgValue);

        address account = msg.sender;
        uint256 zlpAmount = IZlpManager_0_8_18(zlpManager).addLiquidityForAccount(address(this), account, weth, newMsgValue, _minUsdg, _minZlp);

        IRewardTracker_0_8_18(feeZlpTracker).stakeForAccount(account, account, zlp, zlpAmount);
        IRewardTracker_0_8_18(stakedZlpTracker).stakeForAccount(account, account, feeZlpTracker, zlpAmount);

        emit StakeZlp(account, zlpAmount);

        return zlpAmount;
    }

    function unstakeAndRedeemZlp(address _tokenOut, uint256 _zlpAmount, uint256 _minOut, address _receiver) external nonReentrant returns (uint256) {
        require(_zlpAmount > 0, "RewardRouter: invalid _zlpAmount");

        address account = msg.sender;
        IRewardTracker_0_8_18(stakedZlpTracker).unstakeForAccount(account, feeZlpTracker, _zlpAmount, account);
        IRewardTracker_0_8_18(feeZlpTracker).unstakeForAccount(account, zlp, _zlpAmount, account);
        uint256 amountOut = IZlpManager_0_8_18(zlpManager).removeLiquidityForAccount(account, _tokenOut, _zlpAmount, _minOut, _receiver);

        emit UnstakeZlp(account, _zlpAmount);

        return amountOut;
    }

        function unstakeAndRedeemDegenLP(address _tokenOut, uint256 _degenLPAmount, uint256 _minOut, address _receiver) external nonReentrant returns (uint256) {
        require(_degenLPAmount > 0, "RewardRouter: invalid _degenLPAmount");

        address account = msg.sender;
        IRewardTracker_0_8_18(stakedDegenLPTracker).unstakeForAccount(account, feeDegenLPTracker, _degenLPAmount, account);
        IRewardTracker_0_8_18(feeDegenLPTracker).unstakeForAccount(account, degenLP, _degenLPAmount, account);
        uint256 amountOut = IZlpManager_0_8_18(degenLPManager).removeLiquidityForAccount(account, _tokenOut, _degenLPAmount, _minOut, _receiver);

        emit UnstakeDegenLP(account, _degenLPAmount);

        return amountOut;
    }

    function unstakeAndRedeemZlpETH(uint256 _zlpAmount, uint256 _minOut, address payable _receiver) external nonReentrant returns (uint256) {
        require(_zlpAmount > 0, "RewardRouter: invalid _zlpAmount");

        address account = msg.sender;
        IRewardTracker_0_8_18(stakedZlpTracker).unstakeForAccount(account, feeZlpTracker, _zlpAmount, account);
        IRewardTracker_0_8_18(feeZlpTracker).unstakeForAccount(account, zlp, _zlpAmount, account);
        uint256 amountOut = IZlpManager_0_8_18(zlpManager).removeLiquidityForAccount(account, weth, _zlpAmount, _minOut, address(this));

        IWETH_0_8_18(weth).withdraw(amountOut);

        _receiver.sendValue(amountOut);

        emit UnstakeZlp(account, _zlpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;

        IRewardTracker_0_8_18(feeZkeTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(feeZlpTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(feeDegenLPTracker).claimForAccount(account, account);

        IRewardTracker_0_8_18(stakedZkeTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(stakedZlpTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(stakedDegenLPTracker).claimForAccount(account, account);
    }

    function claimEsZke() external nonReentrant {
        address account = msg.sender;

        IRewardTracker_0_8_18(stakedZkeTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(stakedZlpTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(stakedDegenLPTracker).claimForAccount(account, account);
    }

    function claimFees() external nonReentrant {
        address account = msg.sender;

        IRewardTracker_0_8_18(feeZkeTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(feeZlpTracker).claimForAccount(account, account);
        IRewardTracker_0_8_18(feeDegenLPTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(address _account) external nonReentrant onlyGov {
        _compound(_account);
    }

    function handleRewards(
        bool _shouldClaimZke,
        bool _shouldStakeZke,
        bool _shouldClaimEsZke,
        bool _shouldStakeEsZke,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        uint256 zkeAmount = 0;
        if (_shouldClaimZke) {
            uint256 zkeAmount0 = IVester_0_8_18(zkeVester).claimForAccount(account, account);
            uint256 zkeAmount1 = IVester_0_8_18(zlpVester).claimForAccount(account, account);
            uint256 zkeAmount2 = IVester_0_8_18(degenLPVester).claimForAccount(account, account);
            zkeAmount = zkeAmount0 + zkeAmount1 + zkeAmount2;
        }

        if (_shouldStakeZke && zkeAmount > 0) {
            _stakeZke(account, account, zke, zkeAmount);
        }

        uint256 esZkeAmount = 0;
        if (_shouldClaimEsZke) {
            uint256 esZkeAmount0 = IRewardTracker_0_8_18(stakedZkeTracker).claimForAccount(account, account);
            uint256 esZkeAmount1 = IRewardTracker_0_8_18(stakedZlpTracker).claimForAccount(account, account);
            uint256 esZkeAmount2 = IRewardTracker_0_8_18(stakedDegenLPTracker).claimForAccount(account, account);
            esZkeAmount = esZkeAmount0 + esZkeAmount1 + esZkeAmount2;
        }

        if (_shouldStakeEsZke && esZkeAmount > 0) {
            _stakeZke(account, account, esZke, esZkeAmount);
        }

        if (_shouldStakeMultiplierPoints) {
            uint256 bnZkeAmount = IRewardTracker_0_8_18(bonusZkeTracker).claimForAccount(account, account);
            if (bnZkeAmount > 0) {
                IRewardTracker_0_8_18(feeZkeTracker).stakeForAccount(account, account, bnZke, bnZkeAmount);
            }
        }

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 weth0 = IRewardTracker_0_8_18(feeZkeTracker).claimForAccount(account, address(this));
                uint256 weth1 = IRewardTracker_0_8_18(feeZlpTracker).claimForAccount(account, address(this));
                uint256 weth2 = IRewardTracker_0_8_18(feeDegenLPTracker).claimForAccount(account, address(this));

                uint256 wethAmount = weth0 + weth1 + weth2;
                IWETH_0_8_18(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker_0_8_18(feeZkeTracker).claimForAccount(account, account);
                IRewardTracker_0_8_18(feeZlpTracker).claimForAccount(account, account);
                IRewardTracker_0_8_18(feeDegenLPTracker).claimForAccount(account, account);
            }
        }
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    // the _validateReceiver function checks that the averageStakedAmounts and cumulativeRewards
    // values of an account are zero, this is to help ensure that vesting calculations can be
    // done correctly
    // averageStakedAmounts and cumulativeRewards are updated if the claimable reward for an account
    // is more than zero
    // it is possible for multiple transfers to be sent into a single account, using signalTransfer and
    // acceptTransfer, if those values have not been updated yet
    // for ZLP transfers it is also possible to transfer ZLP into an account using the StakedZlp contract
    function signalTransfer(address _receiver) external nonReentrant {
        require(IERC20(zkeVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(zlpVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(degenLPVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");

        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        require(IERC20(zkeVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(zlpVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(degenLPVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");

        address receiver = msg.sender;
        require(pendingReceivers[_sender] == receiver, "RewardRouter: transfer not signalled");
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);
        _compound(_sender);

        uint256 stakedZke = IRewardTracker_0_8_18(stakedZkeTracker).depositBalances(_sender, zke);
        if (stakedZke > 0) {
            _unstakeZke(_sender, zke, stakedZke, false);
            _stakeZke(_sender, receiver, zke, stakedZke);
        }

        uint256 stakedEsZke = IRewardTracker_0_8_18(stakedZkeTracker).depositBalances(_sender, esZke);
        if (stakedEsZke > 0) {
            _unstakeZke(_sender, esZke, stakedEsZke, false);
            _stakeZke(_sender, receiver, esZke, stakedEsZke);
        }

        uint256 stakedBnZke = IRewardTracker_0_8_18(feeZkeTracker).depositBalances(_sender, bnZke);
        if (stakedBnZke > 0) {
            IRewardTracker_0_8_18(feeZkeTracker).unstakeForAccount(_sender, bnZke, stakedBnZke, _sender);
            IRewardTracker_0_8_18(feeZkeTracker).stakeForAccount(_sender, receiver, bnZke, stakedBnZke);
        }

        uint256 esZkeBalance = IERC20(esZke).balanceOf(_sender);
        if (esZkeBalance > 0) {
            IERC20(esZke).transferFrom(_sender, receiver, esZkeBalance);
        }

        uint256 zlpAmount = IRewardTracker_0_8_18(feeZlpTracker).depositBalances(_sender, zlp);
        if (zlpAmount > 0) {
            IRewardTracker_0_8_18(stakedZlpTracker).unstakeForAccount(_sender, feeZlpTracker, zlpAmount, _sender);
            IRewardTracker_0_8_18(feeZlpTracker).unstakeForAccount(_sender, zlp, zlpAmount, _sender);

            IRewardTracker_0_8_18(feeZlpTracker).stakeForAccount(_sender, receiver, zlp, zlpAmount);
            IRewardTracker_0_8_18(stakedZlpTracker).stakeForAccount(receiver, receiver, feeZlpTracker, zlpAmount);
        }

        uint256 degenLPAmount = IRewardTracker_0_8_18(feeDegenLPTracker).depositBalances(_sender, degenLP);
        if (degenLPAmount > 0) {
            IRewardTracker_0_8_18(stakedDegenLPTracker).unstakeForAccount(_sender, feeDegenLPTracker, degenLPAmount, _sender);
            IRewardTracker_0_8_18(feeDegenLPTracker).unstakeForAccount(_sender, degenLP, degenLPAmount, _sender);

            IRewardTracker_0_8_18(feeDegenLPTracker).stakeForAccount(_sender, receiver, degenLP, degenLPAmount);
            IRewardTracker_0_8_18(stakedDegenLPTracker).stakeForAccount(receiver, receiver, feeDegenLPTracker, degenLPAmount);
        }

        IVester_0_8_18(zkeVester).transferStakeValues(_sender, receiver);
        IVester_0_8_18(zlpVester).transferStakeValues(_sender, receiver);
        IVester_0_8_18(degenLPVester).transferStakeValues(_sender, receiver);
    }

    function _validateReceiver(address _receiver) private view {
        require(IRewardTracker_0_8_18(stakedZkeTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedZkeTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(stakedZkeTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedZkeTracker.cumulativeRewards > 0");

        require(IRewardTracker_0_8_18(bonusZkeTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: bonusZkeTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(bonusZkeTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: bonusZkeTracker.cumulativeRewards > 0");

        require(IRewardTracker_0_8_18(feeZkeTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeZkeTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(feeZkeTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeZkeTracker.cumulativeRewards > 0");

        require(IVester_0_8_18(zkeVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: zkeVester.transferredAverageStakedAmounts > 0");
        require(IVester_0_8_18(zkeVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: zkeVester.transferredCumulativeRewards > 0");

        require(IRewardTracker_0_8_18(stakedZlpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedZlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(stakedZlpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedZlpTracker.cumulativeRewards > 0");

        require(IRewardTracker_0_8_18(feeZlpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeZlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(feeZlpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeZlpTracker.cumulativeRewards > 0");

        require(IVester_0_8_18(zlpVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: zkeVester.transferredAverageStakedAmounts > 0");
        require(IVester_0_8_18(zlpVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: zkeVester.transferredCumulativeRewards > 0");

        require(IRewardTracker_0_8_18(stakedDegenLPTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedZlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(stakedDegenLPTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedZlpTracker.cumulativeRewards > 0");

        require(IRewardTracker_0_8_18(feeDegenLPTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeZlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker_0_8_18(feeDegenLPTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeZlpTracker.cumulativeRewards > 0");

        require(IVester_0_8_18(degenLPVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: zkeVester.transferredAverageStakedAmounts > 0");
        require(IVester_0_8_18(degenLPVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: zkeVester.transferredCumulativeRewards > 0");

        require(IERC20(zkeVester).balanceOf(_receiver) == 0, "RewardRouter: zkeVester.balance > 0");
        require(IERC20(zlpVester).balanceOf(_receiver) == 0, "RewardRouter: zlpVester.balance > 0");
        require(IERC20(degenLPVester).balanceOf(_receiver) == 0, "RewardRouter: zlpVester.balance > 0");
    }

    function _compound(address _account) private {
        _compoundZke(_account);
        _compoundZlp(_account);
        _compoundDegenLP(_account);
    }

    function _compoundZke(address _account) private {
        uint256 esZkeAmount = IRewardTracker_0_8_18(stakedZkeTracker).claimForAccount(_account, _account);
        if (esZkeAmount > 0) {
            _stakeZke(_account, _account, esZke, esZkeAmount);
        }

        uint256 bnZkeAmount = IRewardTracker_0_8_18(bonusZkeTracker).claimForAccount(_account, _account);
        if (bnZkeAmount > 0) {
            IRewardTracker_0_8_18(feeZkeTracker).stakeForAccount(_account, _account, bnZke, bnZkeAmount);
        }
    }

    function _compoundZlp(address _account) private {
        uint256 esZkeAmount = IRewardTracker_0_8_18(stakedZlpTracker).claimForAccount(_account, _account);
        if (esZkeAmount > 0) {
            _stakeZke(_account, _account, esZke, esZkeAmount);
        }
    }

    function _compoundDegenLP(address _account) private {
        uint256 esZkeAmount = IRewardTracker_0_8_18(stakedDegenLPTracker).claimForAccount(_account, _account);
        if (esZkeAmount > 0) {
            _stakeZke(_account, _account, esZke, esZkeAmount);
        }
    }

    function _stakeZke(address _fundingAccount, address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        IRewardTracker_0_8_18(stakedZkeTracker).stakeForAccount(_fundingAccount, _account, _token, _amount);
        IRewardTracker_0_8_18(bonusZkeTracker).stakeForAccount(_account, _account, stakedZkeTracker, _amount);
        IRewardTracker_0_8_18(feeZkeTracker).stakeForAccount(_account, _account, bonusZkeTracker, _amount);

        emit StakeZke(_account, _token, _amount);
    }

    function _unstakeZke(address _account, address _token, uint256 _amount, bool _shouldReduceBnZke) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker_0_8_18(stakedZkeTracker).stakedAmounts(_account);

        IRewardTracker_0_8_18(feeZkeTracker).unstakeForAccount(_account, bonusZkeTracker, _amount, _account);
        IRewardTracker_0_8_18(bonusZkeTracker).unstakeForAccount(_account, stakedZkeTracker, _amount, _account);
        IRewardTracker_0_8_18(stakedZkeTracker).unstakeForAccount(_account, _token, _amount, _account);

        if (_shouldReduceBnZke) {
            uint256 bnZkeAmount = IRewardTracker_0_8_18(bonusZkeTracker).claimForAccount(_account, _account);
            if (bnZkeAmount > 0) {
                IRewardTracker_0_8_18(feeZkeTracker).stakeForAccount(_account, _account, bnZke, bnZkeAmount);
            }

            uint256 stakedBnZke = IRewardTracker_0_8_18(feeZkeTracker).depositBalances(_account, bnZke);
            if (stakedBnZke > 0) {
                uint256 reductionAmount = stakedBnZke* _amount / balance;
                IRewardTracker_0_8_18(feeZkeTracker).unstakeForAccount(_account, bnZke, reductionAmount, _account);
                IMintable_0_8_18(bnZke).burn(_account, reductionAmount);
            }
        }

        emit UnstakeZke(_account, _token, _amount);
    }
}
