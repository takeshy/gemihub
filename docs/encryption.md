# Encryption

Hybrid RSA+AES encryption for protecting files stored on Google Drive.

## Features

- **Hybrid Encryption**: RSA-OAEP (2048-bit) + AES-256-GCM for each file
- **Password Protection**: Private key encrypted with PBKDF2-derived key (100,000 iterations)
- **Per-File AES Key**: Each encryption generates a fresh AES-256 key
- **Self-Contained Files**: Each encrypted file contains everything needed for decryption (except the password)
- **Client-Side Decryption**: Encrypted files and history records are decrypted in the browser using the Web Crypto API
- **Password Caching**: Enter password once per session
- **Double-Encryption Prevention**: Already-encrypted content is never re-encrypted

## Encrypted File Format

Encrypted files use YAML frontmatter followed by Base64-encoded data:

```
---
encrypted: true
key: <Base64: encrypted private key (IV + AES-GCM ciphertext)>
salt: <Base64: PBKDF2 salt (16 bytes)>
---
<Base64: key_length(2 bytes) + RSA-encrypted AES key + IV(12 bytes) + AES-GCM ciphertext>
```

The `key` and `salt` fields are copied from your encryption settings at the time of encryption. This makes each file self-contained — decryptable with only the password.

## How It Works

### Setup (Once)

```
Password
  → Generate RSA-2048 key pair (SPKI/PKCS8, Base64)
  → Derive AES-256 key from password using PBKDF2 (SHA-256, 100k iterations, random salt)
  → Encrypt private key with derived key (AES-256-GCM)
  → Store in settings: publicKey, encryptedPrivateKey, salt
```

### Encryption (Per File)

```
Plaintext
  → Generate random AES-256 key
  → Encrypt plaintext with AES-256-GCM (random IV)
  → Encrypt AES key with RSA public key (RSA-OAEP, SHA-256)
  → Pack: key_length(2) + encrypted_AES_key + IV(12) + ciphertext
  → Base64 encode → Wrap with YAML frontmatter
```

### Decryption (Per File)

```
Password + salt
  → Derive AES-256 key via PBKDF2
  → Decrypt private key (AES-256-GCM)
  → Unwrap: extract encrypted AES key, IV, ciphertext
  → Decrypt AES key with RSA private key (RSA-OAEP)
  → Decrypt content with AES key (AES-256-GCM)
  → Plaintext
```

## Binary Layout of Encrypted Data

After Base64 decoding the data section:

```
Offset  Length    Content
0       2         AES key length (big-endian uint16)
2       key_len   RSA-OAEP encrypted AES-256 key
2+kl    12        AES-GCM IV (nonce)
2+kl+12 rest      AES-GCM ciphertext (includes 16-byte auth tag)
```

With RSA-2048 and OAEP-SHA256, `key_len` is typically 256 bytes.

## Usage

### Encrypt a File

Right-click a file in the file tree → **Encrypt**. The file content is encrypted and the file is renamed with `.encrypted` extension.

### Open an Encrypted File

Click an `.encrypted` file in the tree. A password prompt appears. Enter your encryption password to view and edit the decrypted content.

The password is cached in memory for the session. Subsequent encrypted files are decrypted automatically.

### Temp Upload / Download

In the encrypted file editor:
- **Temp Upload**: Re-encrypts the edited content and saves to the temp area (for cross-device transfer without full sync)
- **Temp Download**: Fetches temp content, decrypts, and shows a diff for review

### Chat & Workflow History Encryption

When encryption is enabled and `encryptChatHistory` / `encryptWorkflowHistory` are turned on in settings, new chat histories and workflow execution/request records are encrypted before saving to Drive. Older unencrypted records remain readable. When loading an encrypted record, the app decrypts it client-side using your cached private key or prompts for your password.

## Security Notes

- **Password is never stored** — only the encrypted private key and salt are saved in settings
- **Decryption happens in the browser** — encrypted files and history records are decrypted client-side using the Web Crypto API; the server never sees plaintext of encrypted content
- **Encryption uses server-side crypto for saving** — when saving new encrypted content, the server encrypts using the public key (no password needed) before writing to Drive
- **Each file has a unique AES key** — compromising one file's AES key does not affect others
- **RSA key pair is generated once** — stored encrypted with your password in settings
- **Forgetting your password means data loss** — there is no recovery mechanism

## Python Decryption Script

Encrypted files are self-contained and can be decrypted without Gemini Hub using the following Python script.

### Requirements

```bash
pip install cryptography
```

### Script

```python
#!/usr/bin/env python3
"""Decrypt Gemini Hub encrypted files without the application."""
import base64, sys, re, getpass
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import padding

def decrypt_file(filepath: str, password: str) -> str:
    with open(filepath, 'r') as f:
        content = f.read()

    # Parse YAML frontmatter
    match = re.match(r'^---\n([\s\S]*?)\n---\n([\s\S]*)$', content)
    if not match:
        raise ValueError("Invalid encrypted file format")

    frontmatter, encrypted_data = match.groups()
    key_match = re.search(r'key:\s*(.+)', frontmatter)
    salt_match = re.search(r'salt:\s*(.+)', frontmatter)
    if not key_match or not salt_match:
        raise ValueError("Missing key or salt in frontmatter")

    enc_private_key = base64.b64decode(key_match.group(1).strip())
    salt = base64.b64decode(salt_match.group(1).strip())
    data = base64.b64decode(encrypted_data.strip())

    # Derive key from password (PBKDF2-SHA256, 100k iterations)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000)
    derived_key = kdf.derive(password.encode())

    # Decrypt private key (AES-256-GCM)
    iv, enc_priv = enc_private_key[:12], enc_private_key[12:]
    private_key_pem = AESGCM(derived_key).decrypt(iv, enc_priv, None)
    private_key = serialization.load_der_private_key(base64.b64decode(private_key_pem), None)

    # Parse encrypted data: key_length(2) + enc_aes_key + iv(12) + enc_content
    key_len = (data[0] << 8) | data[1]
    enc_aes_key = data[2:2+key_len]
    content_iv = data[2+key_len:2+key_len+12]
    enc_content = data[2+key_len+12:]

    # Decrypt AES key with RSA private key (RSA-OAEP, SHA-256)
    aes_key = private_key.decrypt(enc_aes_key, padding.OAEP(
        mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))

    # Decrypt content (AES-256-GCM)
    return AESGCM(aes_key).decrypt(content_iv, enc_content, None).decode('utf-8')

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <encrypted_file>")
        sys.exit(1)
    password = getpass.getpass("Password: ")
    print(decrypt_file(sys.argv[1], password))
```

### Usage

```bash
python decrypt.py path/to/file.md.encrypted
# Enter password when prompted
```

## Key Files

| File | Role |
|------|------|
| `app/services/crypto-core.ts` | Encryption/decryption functions (Web Crypto API, shared client/server) |
| `app/services/crypto.server.ts` | Server-side re-export of crypto-core |
| `app/services/crypto-cache.ts` | In-memory password/private key cache (client-side, per session) |
| `app/components/ide/EncryptedFileViewer.tsx` | Password prompt + decrypted file editor |
| `app/routes/api.drive.files.tsx` | Server-side encrypt action |

## Cryptographic Parameters

| Parameter | Value |
|-----------|-------|
| RSA key size | 2048 bits |
| RSA padding | OAEP with SHA-256 |
| AES key size | 256 bits |
| AES mode | GCM (authenticated) |
| AES IV size | 12 bytes (96 bits) |
| KDF | PBKDF2 with SHA-256 |
| KDF iterations | 100,000 |
| KDF salt size | 16 bytes (128 bits) |
| Private key format | PKCS8 (DER, Base64-encoded) |
| Public key format | SPKI (DER, Base64-encoded) |
