"""
Treasury & cashflow allocation engine (backend.finance.treasury).

Extends the existing financial backbone; it does not replace it. The client
Wallet, LedgerEntry, OutboxMessage and charge path stay as they are. This package
adds company-internal wallets and an allocation engine that, after every booking
charge, splits the contribution margin (revenue minus fuel and driver cost) across
funding targets for fixed obligations and reserves, transactionally and idempotently.
"""
