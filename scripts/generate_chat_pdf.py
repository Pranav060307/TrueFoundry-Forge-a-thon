#!/usr/bin/env python3
"""
TrueForge Coding Agent - Development Chat History PDF Generator
Techfest 2026-27, IIT Bombay & TrueFoundry Forge-a-thon

Extracts and formats the entire end-to-end conversation development record
from the session transcript into an executive, publication-quality PDF document.
"""

import os
import sys
import json
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas for running header and footer with total page calculation.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)
        print(f"Chat History PDF generated successfully: {num_pages} pages.")

    def draw_header_footer(self, total_pages):
        self.saveState()
        self.setFont("Helvetica-Bold", 7.5)
        self.setFillColor(colors.HexColor("#1a365d"))

        # Running Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(
                36,
                letter[1] - 25,
                "TrueForge Coding Agent - End-to-End Development Chat History"
            )
            self.setFont("Helvetica", 7.5)
            self.setFillColor(colors.HexColor("#718096"))
            self.drawRightString(
                letter[0] - 36,
                letter[1] - 25,
                "Techfest 2026-27, IIT Bombay | TrueFoundry Forge-a-thon"
            )
            self.setStrokeColor(colors.HexColor("#cbd5e0"))
            self.setLineWidth(0.6)
            self.line(36, letter[1] - 29, letter[0] - 36, letter[1] - 29)

        # Running Footer
        self.setStrokeColor(colors.HexColor("#cbd5e0"))
        self.setLineWidth(0.6)
        self.line(36, 32, letter[0] - 36, 32)

        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#718096"))
        self.drawString(
            36,
            21,
            "Repository: https://github.com/Pranav060307/TrueFoundry-Forge-a-thon.git"
        )
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(letter[0] - 36, 21, page_str)
        self.restoreState()


def format_inline_markdown(text: str) -> str:
    """Escapes XML and converts basic markdown to ReportLab formatting tags."""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")

    # Bold **text**
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    # Italic *text*
    text = re.sub(r"\*([^\*]+?)\*", r"<i>\1</i>", text)
    # Inline code `code`
    text = re.sub(
        r"`([^`]+?)`",
        r'<font face="Courier" color="#1a365d"><b>\1</b></font>',
        text
    )
    return text


def parse_transcript(transcript_path: str):
    """Parses transcript entries into structured conversation turns."""
    if not os.path.exists(transcript_path):
        return []

    dialog = []
    with open(transcript_path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            try:
                e = json.loads(line)
                stype = e.get("type")
                src = e.get("source")
                created = e.get("created_at", "")
                content = e.get("content", "")

                if stype == "USER_INPUT" and src == "USER_EXPLICIT":
                    clean = re.sub(r"<USER_REQUEST>\s*", "", content)
                    clean = re.sub(r"\s*</USER_REQUEST>.*", "", clean, flags=re.DOTALL)
                    clean = re.sub(r"<ADDITIONAL_METADATA>.*", "", clean, flags=re.DOTALL).strip()
                    if clean:
                        dialog.append({
                            "role": "USER",
                            "time": created,
                            "text": clean,
                            "line_num": idx,
                        })
                elif stype == "PLANNER_RESPONSE" and src == "MODEL":
                    if content and content.strip():
                        dialog.append({
                            "role": "ASSISTANT",
                            "time": created,
                            "text": content.strip(),
                            "line_num": idx,
                        })
            except Exception:
                pass
    return dialog


def clean_long_log_payloads(text: str) -> str:
    """Condenses repetitive loop polling logs so the PDF remains readable."""
    if "GET /health HTTP/1.1\" 200 OK" in text and len(text) > 2000:
        lines = text.splitlines()
        head = lines[:15]
        tail = lines[-10:]
        return (
            "\n".join(head)
            + f"\n\n... [Condensed: {len(lines) - 25} repetitive health & pending edit polling lines omitted for readability] ...\n\n"
            + "\n".join(tail)
        )
    return text


def build_chat_pdf():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.abspath(os.path.join(script_dir, ".."))
    output_pdf = os.path.join(workspace_dir, "docs", "TrueForge_Development_Chat_History.pdf")

    # Locate transcript file
    app_data = os.path.expanduser(r"C:\Users\jadha\.gemini\antigravity")
    conv_id = "82285bc9-0d1f-4223-854e-f47332a80c34"
    primary_transcript = os.path.join(app_data, "brain", conv_id, ".system_generated", "logs", "transcript_full.jsonl")
    fallback_transcript = os.path.join(app_data, "brain", conv_id, ".system_generated", "logs", "transcript.jsonl")

    transcript_path = primary_transcript if os.path.exists(primary_transcript) else fallback_transcript
    dialog = parse_transcript(transcript_path)

    doc = SimpleDocTemplate(
        output_pdf,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    styles = getSampleStyleSheet()
    content_width = letter[0] - 72

    # Typography Styles
    title_style = ParagraphStyle(
        "ChatDocTitle",
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=colors.HexColor("#1a365d"),
        spaceAfter=3,
    )

    subtitle_style = ParagraphStyle(
        "ChatDocSubtitle",
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#4a5568"),
        spaceAfter=6,
    )

    h1_style = ParagraphStyle(
        "ChatH1",
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=colors.HexColor("#1a365d"),
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True,
    )

    user_header_style = ParagraphStyle(
        "UserHeader",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#1a365d"),
    )

    agent_header_style = ParagraphStyle(
        "AgentHeader",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#ffffff"),
    )

    time_user_style = ParagraphStyle(
        "TimeUser",
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#4a5568"),
        alignment=2,
    )

    time_agent_style = ParagraphStyle(
        "TimeAgent",
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#e2e8f0"),
        alignment=2,
    )

    body_style = ParagraphStyle(
        "ChatBody",
        fontName="Helvetica",
        fontSize=7.8,
        leading=10.2,
        textColor=colors.HexColor("#2d3748"),
        spaceAfter=2,
        leftIndent=6,
        rightIndent=6,
    )

    bullet_style = ParagraphStyle(
        "ChatBullet",
        parent=body_style,
        leftIndent=16,
    )

    code_block_style = ParagraphStyle(
        "CodeBlock",
        fontName="Courier",
        fontSize=6.8,
        leading=8.8,
        textColor=colors.HexColor("#1a202c"),
    )

    story = []

    # Title & Metadata
    story.append(Paragraph("TrueForge Coding Agent: End-to-End Development Chat History", title_style))
    story.append(Paragraph(
        "Full Engineering Transcript: Planning, Implementation, Debugging, Automated Verification, and Public GitHub Release | Techfest 2026-27, IIT Bombay",
        subtitle_style
    ))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#1a365d"), spaceAfter=5, spaceBefore=0))

    meta_table = Table([
        [
            Paragraph("<b>Project:</b> TrueForge VS Code Coding Agent", body_style),
            Paragraph("<b>Team ID / Track:</b> Techfest 2026-27 | Round 1 Submission", body_style),
        ],
        [
            Paragraph("<b>Repository:</b> github.com/Pranav060307/TrueFoundry-Forge-a-thon", body_style),
            Paragraph(f"<b>Session ID:</b> {conv_id}", body_style),
        ],
        [
            Paragraph("<b>Target Codebase:</b> pallets/flask @ 3.1.3 (commit 22d92470)", body_style),
            Paragraph(f"<b>Total Interaction Turns:</b> {len(dialog)} dialog events", body_style),
        ]
    ], colWidths=[content_width * 0.55, content_width * 0.45])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#edf2f7")),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 6))

    # Executive Development Overview
    story.append(Paragraph("📋 Development Trajectory & Phase Breakdown", h1_style))
    summary_data = [
        [Paragraph("<b>Turn Range</b>", body_style), Paragraph("<b>Engineering Focus & Milestones</b>", body_style), Paragraph("<b>Key Artifacts & Output</b>", body_style)],
        [
            Paragraph("Turns 1 – 5", body_style),
            Paragraph("Phase 0 Architectural Planning & TrueForge Harness Deep Dive", body_style),
            Paragraph("Architecture design, MCP spec, Myers diff plan", body_style)
        ],
        [
            Paragraph("Turns 6 – 12", body_style),
            Paragraph("Milestones M0–M7 Core Implementation & State Checks", body_style),
            Paragraph("TrueForge Client, Sidecar tools, Inline Edit Ctrl+I", body_style)
        ],
        [
            Paragraph("Turns 13 – 16", body_style),
            Paragraph("Competition Hard Rules Alignment & 100% Executable Mandate", body_style),
            Paragraph("Task A/B/C verification test suites, 0-tolerance compliance", body_style)
        ],
        [
            Paragraph("Turns 17 – 25", body_style),
            Paragraph("Live Extension Host Launch & Windows Environment Debugging", body_style),
            Paragraph("Sidecar path resolution, IPv6 [::1] loopback fix", body_style)
        ],
        [
            Paragraph("Turns 26 – 29", body_style),
            Paragraph("Diff Review Accessibility & Screen Reader Mode Handling", body_style),
            Paragraph("Editor title bar buttons, Sidebar review buttons, 1-click demos", body_style)
        ],
        [
            Paragraph("Turns 30 – 32", body_style),
            Paragraph("Final Polish, Test Pass, Comprehensive README & GitHub Push", body_style),
            Paragraph("All suites pass, Clean commit push to origin master", body_style)
        ],
    ]
    summary_table = Table(summary_data, colWidths=[content_width * 0.18, content_width * 0.48, content_width * 0.34])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2b6cb0")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7fafc")]),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("💬 Comprehensive Turn-by-Turn Conversation Transcript", h1_style))
    story.append(Spacer(1, 4))

    # Render each conversation turn sequentially (flowable across pages)
    for i, item in enumerate(dialog):
        role = item["role"]
        raw_text = clean_long_log_payloads(item["text"])
        timestamp = item["time"][:19].replace("T", " ") if item["time"] else ""

        is_user = (role == "USER")
        header_title = f"👤 USER  |  Turn #{i+1}" if is_user else f"🤖 ANTIGRAVITY (TrueForge Lead Agent)  |  Turn #{i+1}"
        h_style = user_header_style if is_user else agent_header_style
        t_style = time_user_style if is_user else time_agent_style

        # Banner Table
        header_row = [
            Paragraph(f"<b>{header_title}</b>", h_style),
            Paragraph(timestamp, t_style),
        ]
        header_table = Table([header_row], colWidths=[content_width * 0.72, content_width * 0.28])
        header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#bee3f8" if is_user else "#1a365d")),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#90cdf4" if is_user else "#102a43")),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))

        story.append(header_table)
        story.append(Spacer(1, 2))

        # Split content into text segments and code blocks
        blocks = raw_text.split("```")
        for b_idx, block in enumerate(blocks):
            if b_idx % 2 == 1:
                # Code block
                code_text = block.strip()
                lines = code_text.splitlines()
                if lines and lines[0].strip().lower() in ["python", "bash", "sh", "javascript", "json", "typescript", "text"]:
                    code_text = "\n".join(lines[1:])
                code_p = Paragraph(
                    format_inline_markdown(code_text).replace("\n", "<br/>&nbsp;&nbsp;"),
                    code_block_style
                )
                code_box = Table([[code_p]], colWidths=[content_width])
                code_box.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f7fafc")),
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
                    ('TOPPADDING', (0, 0), (-1, -1), 2.5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ]))
                story.append(code_box)
                story.append(Spacer(1, 2))
            else:
                # Normal text
                paras = [p.strip() for p in block.split("\n\n") if p.strip()]
                for p_text in paras:
                    if p_text.startswith("### "):
                        p = Paragraph(f"<b>{format_inline_markdown(p_text[4:])}</b>", ParagraphStyle(
                            "SubH", parent=body_style, fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=colors.HexColor("#2b6cb0")
                        ))
                    elif p_text.startswith("## "):
                        p = Paragraph(f"<b>{format_inline_markdown(p_text[3:])}</b>", ParagraphStyle(
                            "SubH2", parent=body_style, fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=colors.HexColor("#1a365d")
                        ))
                    elif p_text.startswith("# "):
                        p = Paragraph(f"<b>{format_inline_markdown(p_text[2:])}</b>", ParagraphStyle(
                            "SubH1", parent=body_style, fontName="Helvetica-Bold", fontSize=9.5, leading=12.5, textColor=colors.HexColor("#1a365d")
                        ))
                    elif p_text.startswith("- ") or p_text.startswith("* "):
                        bullet_lines = p_text.splitlines()
                        for bl in bullet_lines:
                            bl_clean = re.sub(r"^[-*]\s*", "", bl)
                            story.append(Paragraph(f"• {format_inline_markdown(bl_clean)}", bullet_style))
                        story.append(Spacer(1, 1))
                        continue
                    else:
                        p = Paragraph(format_inline_markdown(p_text).replace("\n", "<br/>"), body_style)
                    story.append(p)
                    story.append(Spacer(1, 2))

        # Bottom divider between turns
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0"), spaceAfter=5, spaceBefore=2))

    doc.build(story, canvasmaker=NumberedCanvas)


if __name__ == "__main__":
    build_chat_pdf()
