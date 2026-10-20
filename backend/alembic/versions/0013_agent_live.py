"""agents.live: a heartbeat from an outside process (the Qoder CLI) driving an agent

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-20

Data: none; existing agents start with no heartbeat.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("live", JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "live")
