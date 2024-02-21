// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/utils/ReentrancyGuard.sol";
import "../access/Governable.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "./Timelock.sol";
import "../core/interfaces/IPositionRouter.sol";

contract FeeRouter is Governable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event WithdrawFees(address[] tokens, address receiver);
    event WithdrawTokens(address[] tokens, address receiver);
    event WithdrawEth(address receiver);
    event UpdateState(
        Timelock timelock,
        address vault,
        IPositionRouter[] routers
    );

    Timelock public timelock;
    address public vault;
    IPositionRouter[] public routers;

    constructor(
        Timelock _timelock,
        address _vault,
        IPositionRouter[] memory _routers
    ) public {
        timelock = _timelock;
        vault = _vault;
        routers = _routers;
    }

    function withdrawFees(
        address[] memory _tokens,
        address _receiver
    ) public onlyGov nonReentrant {
        require(_tokens.length > 0, "FeeRouter: invalid _tokens");

        for (uint256 i; i < _tokens.length; i++) {
            timelock.withdrawFees(vault, _tokens[i], _receiver);

            for (uint256 i2; i2 < routers.length; i2++) {
                routers[i2].withdrawFees(_tokens[i], _receiver);
            }
        }

        emit WithdrawFees(_tokens, _receiver);
    }

    function withdrawTokens(
        address[] memory _tokens,
        address _receiver
    ) external onlyGov nonReentrant {
        require(_tokens.length > 0, "FeeRouter: invalid _tokens");

        for (uint256 i; i < _tokens.length; i++) {
            uint256 amount = IERC20(_tokens[i]).balanceOf(address(this));
            IERC20(_tokens[i]).safeTransfer(_receiver, amount);
        }

        emit WithdrawTokens(_tokens, _receiver);
    }

    function withdrawEth(
        address payable _receiver
    ) external onlyGov nonReentrant {
        require(_receiver != address(0), "FeeRouter: invalid _receiver");
        uint256 amount = address(this).balance;

        (bool success, ) = _receiver.call{value: amount}("");
        require(success, "FeeRouter: not success");

        emit WithdrawEth(_receiver);
    }

    function updateState(
        Timelock _timelock,
        address _vault,
        IPositionRouter[] memory _routers
    ) public onlyGov nonReentrant {
        require(
            address(_timelock) != address(0),
            "FeeRouter: invalid _timelock"
        );
        require(_vault != address(0), "FeeRouter: invalid _vault");
        require(_routers.length > 0, "FeeRouter: invalid _routers");

        timelock = _timelock;
        vault = _vault;
        routers = _routers;

        emit UpdateState(_timelock, _vault, _routers);
    }

    receive() external payable {}
}
