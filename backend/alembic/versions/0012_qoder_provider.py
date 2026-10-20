"""runs.provider: allow 'qoder' for the Qoder CLI stage worker

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-20

Data: none; existing rows keep their provider.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_runs_run_provider"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_provider"), "runs", "provider IN ('ollama', 'anthropic', 'fake', 'qoder')"
    )


def downgrade() -> None:
    op.execute("UPDATE runs SET provider = 'ollama' WHERE provider = 'qoder'")
    op.drop_constraint(op.f("ck_runs_run_provider"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_provider"), "runs", "provider IN ('ollama', 'anthropic', 'fake')"
    )
