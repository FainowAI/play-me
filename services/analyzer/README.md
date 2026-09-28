# services/analyzer — análise de áudio

Python 3.11+, roda no WSL2 (Ubuntu) ou Docker. Pipeline: decode → Beat This! (grade) → compassos → loudness → energia por banda → tom → stems → seções/frases → cues → planejador (regras + Jev).

Regras: Beat This! é a única fonte da grade; tudo indexado por compasso; análise idempotente por sha256 + versão.

O esqueleto é criado no prompt 01; a grade (Fase 0) no prompt 02.