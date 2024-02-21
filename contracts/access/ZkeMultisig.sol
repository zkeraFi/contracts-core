//SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "../libraries/token/IERC20.sol";
import "../libraries/token/ERC721/IERC721.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "./interfaces/IZkeMultisig.sol";

contract ZkeMultisig is IZkeMultisig, ReentrancyGuard {

    event SignalApprove(
        address token,
        address spender,
        uint256 amount,
        bytes32 action,
        uint256 nonce
    );
    event SignalApproveNFTs(
        address token,
        address spender,
        uint256[] tokenIds,
        bytes32 action,
        uint256 nonce
    );
    event SignalApproveAllNFT(
        address token,
        address spender,
        bool approved,
        bytes32 action,
        uint256 nonce
    );
    event SignalTransferNFTs(
        address token,
        address[] receivers,
        uint256[] tokenIds,
        bytes32 action,
        uint256 nonce
    );
    event SignalTransfer(
        address token,
        address to,
        uint256 amount,
        bytes32 action,
        uint256 nonce
    );
    event SignalTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount,
        bytes32 action,
        uint256 nonce
    );
    event SignalTransferETH(
        address to,
        uint256 amount,
        bytes32 action,
        uint256 nonce
    );
    event SignalTransaction(
        address to,
        uint256 value,
        bytes data,
        bytes32 action,
        uint256 nonce
    );
    event SignalSetMinAuthorizations(
        uint256 minAuthorizations,
        bytes32 action,
        uint256 nonce
    );
    event SignalSetSigner(
        address signer,
        bool isSigner,
        bytes32 action,
        uint256 nonce
    );
    event SignalPendingAction(bytes32 action, uint256 nonce);
    event SignAction(bytes32 action, uint256 nonce);
    event ClearAction(bytes32 action, uint256 nonce);

    uint256 public actionsNonce;
    uint256 public minAuthorizations;

    address[] public signers;
    mapping(address => bool) public isSigner;
    mapping(bytes32 => bool) public pendingActions;
    mapping(address => mapping(bytes32 => bool)) public signedActions;   

    constructor(
        address[] memory _signers,
        uint256 _minAuthorizations
        ) public {
        minAuthorizations = _minAuthorizations;
        signers = _signers;
        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            isSigner[signer] = true;
        }
    }

    receive() external payable {}

    modifier onlySigner() {
        require(isSigner[msg.sender], "ZkeMultisig: forbidden");
        _;
    }

    function signersLength() public view returns (uint256) {
        return signers.length;
    }

    function signalApprove(address _token, address _spender, uint256 _amount) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount, nonce));
        _setPendingAction(action, nonce);
        emit SignalApprove(_token, _spender, _amount, action, nonce);
    }

    function signApprove(address _token, address _spender, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function approve(address _token, address _spender, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        IERC20(_token).approve(_spender, _amount);
        _clearAction(action, _nonce);
    }

    function signalApproveNFTs(address _token, address _spender, uint256[] memory _tokenIds) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("approveNFTs", _token, _spender, _tokenIds, nonce));
        _setPendingAction(action, nonce);
        emit SignalApproveNFTs(_token, _spender, _tokenIds, action, nonce);
    }

    function signApproveNFTs(address _token, address _spender, uint256[] memory _tokenIds, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approveNFTs", _token, _spender, _tokenIds, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function approveNFTs(address _token, address _spender, uint256[] memory _tokenIds, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approveNFTs", _token, _spender, _tokenIds, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        for (uint256 i = 0 ; i < _tokenIds.length; i++) {
            IERC721(_token).approve(_spender, _tokenIds[i]);
        }
        _clearAction(action, _nonce);
    }

    function signalApproveAllNFT(address _token, address _spender, bool _approved) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("approveAllNFT", _token, _spender, _approved, nonce));
        _setPendingAction(action, nonce);
        emit SignalApproveAllNFT(_token, _spender, _approved, action, nonce);
    }

    function signApproveAllNFT(address _token, address _spender, bool _approved, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approveAllNFT", _token, _spender, _approved, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function approveAllNFT(address _token, address _spender, bool _approved, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("approveAllNFT", _token, _spender, _approved, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        IERC721(_token).setApprovalForAll(_spender, _approved);
        
        _clearAction(action, _nonce);
    }

    function receiveNFTs(address _token, address _sender, uint256[] memory _tokenIds) external override nonReentrant onlySigner {
        for (uint256 i = 0 ; i < _tokenIds.length; i++) {
            IERC721(_token).transferFrom(_sender, address(this), _tokenIds[i]);
        }
    }

    function signalTransferNFTs(address _token, address[] calldata _receivers, uint256[] calldata _tokenIds) external override nonReentrant onlySigner {
        require(_receivers.length == _tokenIds.length,"ZkeMultisig: lengths invalid");
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("transferNFTs", _token, _receivers, _tokenIds, nonce));
        _setPendingAction(action, nonce);
        emit SignalTransferNFTs(_token, _receivers, _tokenIds, action, nonce);
    }

    function signTransferNFTs(address _token, address[] calldata _receivers, uint256[] calldata _tokenIds, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferNFTs", _token, _receivers, _tokenIds, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function transferNFTs(address _token, address[] calldata _receivers, uint256[] calldata _tokenIds, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferNFTs", _token, _receivers, _tokenIds, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        for (uint256 i = 0 ; i < _receivers.length; i++) {
            IERC721(_token).transferFrom(address(this), _receivers[i], _tokenIds[i]);
        }
        _clearAction(action, _nonce);
    }

    function signalTransfer(address _token, address _to, uint256 _amount) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("transfer", _token, _to, _amount, nonce));
        _setPendingAction(action, nonce);
        emit SignalTransfer(_token, _to, _amount, action, nonce);
    }

    function signTransfer(address _token, address _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transfer", _token, _to, _amount, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function transfer(address _token, address _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transfer", _token, _to, _amount, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        IERC20(_token).transfer(_to, _amount);
        _clearAction(action, _nonce);
    }

    function signalTransferFrom(address _token, address _from, address _to, uint256 _amount) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("transferFrom", _token, _from, _to, _amount, nonce));
        _setPendingAction(action, nonce);
        emit SignalTransferFrom(_token, _from, _to, _amount, action, nonce);
    }

    function signTransferFrom(address _token, address _from, address _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferFrom", _token, _from, _to, _amount, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function transferFrom(address _token, address _from, address _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferFrom", _token, _from, _to, _amount, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        IERC20(_token).transferFrom(_from, _to, _amount);
        _clearAction(action, _nonce);
    }

    function signalTransferETH(address _to, uint256 _amount) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked("transferETH", _to, _amount, nonce));
        _setPendingAction(action, nonce);
        emit SignalTransferETH(_to, _amount, action, nonce);
    }

    function signTransferETH(address _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferETH", _to, _amount, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function transferETH(address payable _to, uint256 _amount, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked("transferETH", _to, _amount, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        (bool success,) = _to.call{value:_amount}("");
        require(success, "ZkeMultisig: not success");
        _clearAction(action, _nonce);
    }

     function signalTransaction(address _to, uint _value, bytes calldata _data) external override nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked(_to, _value, _data, nonce));
        _setPendingAction(action, nonce);
        emit SignalTransaction(_to, _value, _data, action, nonce);
    }
    
    function signTransaction(address _to, uint _value, bytes calldata _data, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked(_to, _value, _data, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], "ZkeMultisig: already signed");
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function executeTransaction(address _to, uint _value, bytes calldata _data, uint256 _nonce) external override nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked(_to, _value, _data, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        (bool success,) = _to.call{value:_value}(_data);
        require(success, "ZkeMultisig: not success");
        _clearAction(action, _nonce);
    }

    function signalSetMinAuthorizations(
        uint256 _minAuthorizations
    ) external override nonReentrant onlySigner {
        require(_minAuthorizations > 1 && _minAuthorizations <= signersLength(), "ZkeMultisig: invalid _minAuthorizations");
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(
            abi.encodePacked("setMinAuthorizations", _minAuthorizations, nonce)
        );
        _setPendingAction(action, nonce);
        emit SignalSetMinAuthorizations(_minAuthorizations, action, nonce);
    }

    function signSetMinAuthorizations(
        uint256 _minAuthorizations,
        uint256 _nonce
    ) external override nonReentrant onlySigner {
        bytes32 action = keccak256(
            abi.encodePacked("setMinAuthorizations", _minAuthorizations, _nonce)
        );
        _validateAction(action);
        require(
            !signedActions[msg.sender][action],
            "ZkeMultisig: already signed"
        );
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function setMinAuthorizations(
        uint256 _minAuthorizations,
        uint256 _nonce
    ) external override nonReentrant onlySigner {
        bytes32 action = keccak256(
            abi.encodePacked("setMinAuthorizations", _minAuthorizations, _nonce)
        );
        _validateAction(action);
        _validateAuthorization(action);

        minAuthorizations = _minAuthorizations;
        _clearAction(action, _nonce);
    }

    function signalSetSigner(
        address _signer,
        bool _isSigner
    ) external override nonReentrant onlySigner {
        require(isSigner[_signer] == !_isSigner, "ZkeMultisig: invalid _isSigner");
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(
            abi.encodePacked("setSigner", _signer, _isSigner, nonce)
        );
        _setPendingAction(action, nonce);
        emit SignalSetSigner(_signer, _isSigner, action, nonce);
    }

    function signSetSigner(
        address _signer,
        bool _isSigner,
        uint256 _nonce
    ) external override nonReentrant onlySigner {
        bytes32 action = keccak256(
            abi.encodePacked("setSigner", _signer, _isSigner, _nonce)
        );
        _validateAction(action);
        require(
            !signedActions[msg.sender][action],
            "ZkeMultisig: already signed"
        );
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function setSigner(
        address _signer,
        bool _isSigner,
        uint256 _nonce
    ) external override nonReentrant onlySigner {
        bytes32 action = keccak256(
            abi.encodePacked("setSigner", _signer, _isSigner, _nonce)
        );
        _validateAction(action);
        _validateAuthorization(action);

        if(_isSigner){
            signers.push(_signer);
            isSigner[_signer] = true;
        }
        else{
            deleteSigner(_signer);
            isSigner[_signer] = false;
        }
        _clearAction(action, _nonce);
    }

    function _setPendingAction(bytes32 _action, uint256 _nonce) private {
        pendingActions[_action] = true;
        emit SignalPendingAction(_action, _nonce);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action], "ZkeMultisig: action not signalled");
    }

    function _validateAuthorization(bytes32 _action) private view {
        uint256 count = 0;
        for (uint256 i = 0; i < signers.length; i++) {
            address signer = signers[i];
            if (signedActions[signer][_action]) {
                count++;
            }
        }

        if (count == 0) {
            revert("ZkeMultisig: action not authorized");
        }
        require(
            count >= minAuthorizations,
            "ZkeMultisig: insufficient authorization"
        );
    }

    function _clearAction(bytes32 _action, uint256 _nonce) private {
        require(pendingActions[_action], "ZkeMultisig: invalid _action");
        delete pendingActions[_action];
        emit ClearAction(_action, _nonce);
    }

    function deleteSigner(address _signer) private {
        uint256 indexDelete = getIndex(_signer);
        uint256 indexEnd = signers.length - 1;
        if (indexDelete == indexEnd) {
            signers.pop();
        } else {
            signers[indexDelete] = signers[indexEnd];
            signers.pop();
        }
    }

    function getIndex(address _signer) private view returns (uint256) {
        address[] memory _signers = signers;
        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == _signer) {
                return i;
            }
        }
        revert("ZkeMultisig: signer not found");
    }
}
