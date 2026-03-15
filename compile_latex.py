#!/usr/bin/env python3
"""
compile_latex.py — compile a .tex file to PDF using pdflatex.
Runs pdflatex twice (for proper page references), captures errors cleanly.

Usage: python3 compile_latex.py <tex_file> <output_dir>
"""

import subprocess
import sys
import os


def compile_pdf(tex_path: str, out_dir: str) -> None:
    if not os.path.isfile(tex_path):
        print(f"Error: {tex_path} not found", file=sys.stderr)
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        f"-output-directory={out_dir}",
        tex_path,
    ]

    # Run twice for cross-references
    for run in range(2):
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0 and run == 1:
            # Only fail on the second pass
            print(result.stdout[-2000:], file=sys.stderr)
            print(result.stderr[-500:], file=sys.stderr)
            sys.exit(result.returncode)

    pdf_name = os.path.splitext(os.path.basename(tex_path))[0] + ".pdf"
    pdf_path = os.path.join(out_dir, pdf_name)
    if os.path.isfile(pdf_path):
        print(f"PDF generated: {pdf_path}")
    else:
        print("Warning: pdflatex ran but PDF not found", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <tex_file> <output_dir>", file=sys.stderr)
        sys.exit(1)
    compile_pdf(sys.argv[1], sys.argv[2])
