//SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IZkeMultisig {
    function signalApprove(
        address _token,
        address _spender,
        uint256 _amount
    ) external;

    function signApprove(
        address _token,
        address _spender,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function approve(
        address _token,
        address _spender,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function signalApproveNFTs(
        address _token,
        address _spender,
        uint256[] memory _tokenIds
    ) external;

    function signApproveNFTs(
        address _token,
        address _spender,
        uint256[] memory _tokenIds,
        uint256 _nonce
    ) external;

    function approveNFTs(
        address _token,
        address _spender,
        uint256[] memory _tokenIds,
        uint256 _nonce
    ) external;

    function signalApproveAllNFT(
        address _token,
        address _spender,
        bool _approved
    ) external;

    function signApproveAllNFT(
        address _token,
        address _spender,
        bool _approved,
        uint256 _nonce
    ) external;

    function approveAllNFT(
        address _token,
        address _spender,
        bool _approved,
        uint256 _nonce
    ) external;

    function receiveNFTs(
        address _token,
        address _sender,
        uint256[] memory _tokenIds
    ) external;

    function signalTransferNFTs(
        address _token,
        address[] calldata _receivers,
        uint256[] calldata _tokenIds
    ) external;

    function signTransferNFTs(
        address _token,
        address[] calldata _receivers,
        uint256[] calldata _tokenIds,
        uint256 _nonce
    ) external;

    function transferNFTs(
        address _token,
        address[] calldata _receivers,
        uint256[] calldata _tokenIds,
        uint256 _nonce
    ) external;

    function signalTransfer(
        address _token,
        address _to,
        uint256 _amount
    ) external;

    function signTransfer(
        address _token,
        address _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function transfer(
        address _token,
        address _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function signalTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _amount
    ) external;

    function signTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function transferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function signalTransferETH(address _to, uint256 _amount) external;

    function signTransferETH(
        address _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function transferETH(
        address payable _to,
        uint256 _amount,
        uint256 _nonce
    ) external;

    function signalTransaction(
        address _to,
        uint _value,
        bytes calldata _data
    ) external;

    function signTransaction(
        address _to,
        uint _value,
        bytes calldata _data,
        uint256 _nonce
    ) external;

    function executeTransaction(
        address _to,
        uint _value,
        bytes calldata _data,
        uint256 _nonce
    ) external;

    function signalSetMinAuthorizations(uint256 _minAuthorizations) external;

    function signSetMinAuthorizations(
        uint256 _minAuthorizations,
        uint256 _nonce
    ) external;

    function setMinAuthorizations(
        uint256 _minAuthorizations,
        uint256 _nonce
    ) external;

    function signalSetSigner(address _signer, bool _isSigner) external;

    function signSetSigner(
        address _signer,
        bool _isSigner,
        uint256 _nonce
    ) external;

    function setSigner(
        address _signer,
        bool _isSigner,
        uint256 _nonce
    ) external;
}
