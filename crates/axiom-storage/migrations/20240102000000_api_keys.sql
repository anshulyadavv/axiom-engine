CREATE TABLE tenant_api_keys (
    key_id VARCHAR(255) PRIMARY KEY,
    tenant_id UUID NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_tenant_api_keys_tenant_id ON tenant_api_keys(tenant_id);

-- Insert a dummy key for local testing and E2E scripts
-- Key: axm_live_dummykey
-- Hash: 8d96a95d2dc44888b99d4de3727858c98098ddcb516fe4f257a83b04b2da917d
INSERT INTO tenant_api_keys (key_id, tenant_id, key_hash, description)
VALUES ('dummy_key_1', '00000000-0000-0000-0000-000000000001', '8d96a95d2dc44888b99d4de3727858c98098ddcb516fe4f257a83b04b2da917d', 'Dummy Key for E2E Tests');
