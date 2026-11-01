#!/usr/bin/env python3
"""
TrueForge Coding Agent - 4-Minute Demo Video Walkthrough Script PDF Generator
Techfest 2026-27, IIT Bombay & TrueFoundry Forge-a-thon (Round 1 Submission)

Renders docs/DEMO_SCRIPT.md into a professional, publication-quality PDF.
"""

import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
    HRFlowable,
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas for dynamic total page counting, running header and footer.
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
        print(f"Demo Script PDF generated successfully: {num_pages} pages.")

    def draw_header_footer(self, total_pages):
        self.saveState()
        self.setFont("Helvetica-Bold", 7.5)
        self.setFillColor(colors.HexColor("#1a365d"))

        # Running Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(
                36,
                letter[1] - 25,
                "TrueForge Coding Agent - 4-Minute Demo Video Walkthrough Script"
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
            "Target Codebase: pallets/flask @ 3.1.3 (commit 22d92470) | Strict Under 4-Minute Compliance"
        )
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(letter[0] - 36, 21, page_str)
        self.restoreState()


def build_script_pdf():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.abspath(os.path.join(script_dir, ".."))
    output_pdf = os.path.join(workspace_dir, "docs", "TrueForge_Demo_Video_Script.pdf")

    # Document Setup (margins: 36pt = 0.5 in)
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

    # Custom typography styles
    title_style = ParagraphStyle(
        "DocTitle",
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=colors.HexColor("#1a365d"),
        spaceAfter=3,
    )

    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#4a5568"),
        spaceAfter=6,
    )

    h1_style = ParagraphStyle(
        "SectionH1",
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=colors.HexColor("#1a365d"),
        spaceBefore=7,
        spaceAfter=4,
        keepWithNext=True,
    )

    h2_style = ParagraphStyle(
        "SectionH2",
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#2b6cb0"),
        spaceBefore=5,
        spaceAfter=3,
        keepWithNext=True,
    )

    body_style = ParagraphStyle(
        "BodyDark",
        fontName="Helvetica",
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#2d3748"),
        spaceAfter=3,
    )

    bold_body = ParagraphStyle(
        "BoldBody",
        parent=body_style,
        fontName="Helvetica-Bold",
    )

    voiceover_style = ParagraphStyle(
        "VoiceoverStyle",
        fontName="Helvetica-Oblique",
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#1a365d"),
    )

    code_style = ParagraphStyle(
        "CodeStyle",
        fontName="Courier",
        fontSize=7.2,
        leading=9.2,
        textColor=colors.HexColor("#2d3748"),
    )

    story = []

    # Title & Metadata Banner
    story.append(Paragraph("TrueForge Coding Agent: 4-Minute Demo Video Walkthrough Script", title_style))
    story.append(Paragraph("Turn-by-Turn Production Script & On-Screen Verification Guide | Techfest 2026-27, IIT Bombay & TrueFoundry Forge-a-thon", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#1a365d"), spaceAfter=5, spaceBefore=0))

    # Meta badges table
    meta_data = [
        [
            Paragraph("<b>Target Codebase:</b> pallets/flask @ 3.1.3 (commit 22d92470)", body_style),
            Paragraph("<b>Duration Limit:</b> Strictly &lt; 4:00 minutes", body_style),
        ],
        [
            Paragraph("<b>GitHub:</b> github.com/Pranav060307/TrueFoundry-Forge-a-thon", body_style),
            Paragraph("<b>Harness:</b> @truefoundry/trueforge (port 8790)", body_style),
        ]
    ]
    meta_table = Table(meta_data, colWidths=[content_width * 0.55, content_width * 0.45])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#edf2f7")),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 5))

    # Rules Checklist Callout Box
    rules_text = (
        "<b>OFFICIAL COMPETITION VIDEO RULES (PDF Pages 5–6):</b><br/>"
        "• <b>Duration:</b> Exactly under 4 minutes (max 04:00). Videos exceeding 4:00 risk disqualification.<br/>"
        "• <b>Task Sequence:</b> Tasks <b>A</b>, <b>B</b>, and <b>C</b> must be shown in that <b>exact order</b>.<br/>"
        "• <b>Verification:</b> Every task must be followed immediately by its on-screen terminal verification command.<br/>"
        "• <b>TrueForge Inspection:</b> The TrueForge session inspector (turns and tool calls) must be briefly shown in Task B.<br/>"
        "• <b>No Cut Policy:</b> You may fast-forward model generation time, but do NOT cut between prompt submission and diff appearance."
    )
    rules_table = Table([[Paragraph(rules_text, body_style)]], colWidths=[content_width])
    rules_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#fffaf0")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#dd6b20")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(rules_table)
    story.append(Spacer(1, 6))

    # Timeline Summary Table
    story.append(Paragraph("⏱️ Master Timeline & Scene Summary", h1_style))
    summary_data = [
        [Paragraph("<b>Scene</b>", bold_body), Paragraph("<b>Timestamp</b>", bold_body), Paragraph("<b>Core Task & Actions</b>", bold_body), Paragraph("<b>On-Screen Verification</b>", bold_body)],
        [
            Paragraph("<b>Scene 1</b>", body_style),
            Paragraph("00:00 – 00:14", body_style),
            Paragraph("System health check, status bar handshakes", body_style),
            Paragraph("TrueForge :8790 & Sidecar :4545 online", body_style)
        ],
        [
            Paragraph("<b>Scene 2</b>", body_style),
            Paragraph("00:15 – 00:52", body_style),
            Paragraph("<b>Task A:</b> Inline Edit on <code>get_debug_flag</code>", body_style),
            Paragraph("<code>FLASK_DEBUG=off</code> returns <code>False</code>", body_style)
        ],
        [
            Paragraph("<b>Scene 3</b>", body_style),
            Paragraph("00:53 – 02:08", body_style),
            Paragraph("<b>Task B:</b> Agent Mode unprompted across 3+ files", body_style),
            Paragraph("<code>git diff --stat</code> (3 files), <code>flask config</code> masked JSON, pytest 56 passed", body_style)
        ],
        [
            Paragraph("<b>Scene 4</b>", body_style),
            Paragraph("02:09 – 02:35", body_style),
            Paragraph("Token streaming & interactive cancellation", body_style),
            Paragraph("Instant Stop, <code>git status</code> clean", body_style)
        ],
        [
            Paragraph("<b>Scene 5</b>", body_style),
            Paragraph("02:36 – 03:25", body_style),
            Paragraph("<b>Task C:</b> Resilience & Transparent Auto Fallback", body_style),
            Paragraph("401 auth caught, transparent switch to secondary", body_style)
        ],
        [
            Paragraph("<b>Scene 6</b>", body_style),
            Paragraph("03:26 – 04:00", body_style),
            Paragraph("Full test suite run & repository transparency", body_style),
            Paragraph("<code>npm test</code> 5/5 passed, Write-up PDF shown", body_style)
        ],
    ]
    summary_table = Table(summary_data, colWidths=[content_width * 0.12, content_width * 0.18, content_width * 0.38, content_width * 0.32])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2b6cb0")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7fafc")]),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 8))

    # Detailed Scene Breakdown
    scenes = [
        {
            "num": "Scene 1: Introduction & System Health Handshake",
            "time": "00:00 – 00:14 (Duration: 14s)",
            "visual": "VS Code editor open with <code>pallets/flask</code> workspace. Status bar and Agent Panel visible.",
            "actions": [
                "Point mouse to status bar showing <b>TrueForge: Connected (:8790)</b> and <b>Sidecar: Healthy (:4545)</b>.",
                "Briefly reveal the TrueForge Agent panel in the left sidebar showing green status badges.",
            ],
            "voiceover": "This is TrueForge Coding Agent, an editor-native coding assistant built strictly on TrueFoundry's TrueForge harness. All reasoning runs on TrueForge at localhost:8790, while editor capabilities are exposed as MCP tools via a local Python sidecar.",
            "commands": None
        },
        {
            "num": "Scene 2: Task A – Inline Edit & Diff Review (src/flask/helpers.py)",
            "time": "00:15 – 00:52 (Duration: 37s)",
            "visual": "Open <code>src/flask/helpers.py</code>, navigate to line 26 (<code>def get_debug_flag()</code>).",
            "actions": [
                "Select <code>get_debug_flag</code> and press <b>Ctrl+I</b> (or click <b>⚡ Task A</b> in webview header).",
                "Submit prompt: <i>'Treat the values \"off\" and \"n\" as false as well, case-insensitively, and update the docstring to list every value that is treated as false.'</i>",
                "Virtual diff editor (<code>trueforge-diff://</code>) opens side-by-side with 0-line context Myers hunks.",
                "Demonstrate per-hunk review: click <b>[✓ Accept Hunk]</b> (or use title bar check icon).",
            ],
            "voiceover": "For Task A, we trigger an inline edit with Ctrl+I. TrueForge stages surgical Myers diff hunks strictly in memory. We inspect the proposed changes side-by-side and accept them hunk-by-hunk.",
            "commands": [
                ('FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"', 'False (Baseline returned True)'),
                ('FLASK_DEBUG=n python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"', 'False'),
                ('FLASK_DEBUG=1 python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"', 'True'),
            ]
        },
        {
            "num": "Scene 3: Task B – Autonomous Agent Mode Across 3+ Files (flask config)",
            "time": "00:53 – 02:08 (Duration: 75s)",
            "visual": "Switch focus to sidebar Agent Panel. Terminal ready below for verification.",
            "actions": [
                "Submit unprompted goal (no files named) or click <b>⚡ Task B (3 Files)</b>: <i>'Add a new built-in CLI command flask config that prints the loaded application configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \"***\". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.'</i>",
                "Show <b>Context Engine Table</b>: BM25 ranker + AST outlines within 4,000-token budget.",
                "Agent autonomously invokes MCP tools (<code>search_workspace</code>, <code>read_file</code>, <code>propose_write</code>).",
                "Briefly switch to browser/terminal showing the <b>TrueForge Session</b> at <code>localhost:8790</code>.",
                "Review virtual diffs touching 3 files (<code>cli.py</code>, <code>test_cli.py</code>, <code>docs/cli.rst</code>) and click <b>[Accept All Hunks]</b>.",
            ],
            "voiceover": "In Task B, the agent operates autonomously with no files named. It queries our MCP tools, retrieves context under a 4,000 token budget, and stages edits across three files. Notice the TrueForge session inspector tracking all turns. Once accepted, we run tests.",
            "commands": [
                ('git diff --stat', '3 files changed, 60 insertions(+) (docs/cli.rst, src/flask/cli.py, tests/test_cli.py)'),
                ('flask --help', 'Commands list includes: config (Show current application configuration)'),
                ('flask config', 'Outputs formatted JSON with SECRET_KEY, APP_SECRET, API_KEY masked as "***"'),
                ('pytest tests/test_cli.py -q', '56 passed, 3 skipped in 0.54s (All CLI tests green)'),
            ]
        },
        {
            "num": "Scene 4: Streaming Tokens & Instant Safe Cancellation",
            "time": "02:09 – 02:35 (Duration: 26s)",
            "visual": "Agent Panel in sidebar. Terminal open alongside.",
            "actions": [
                "Type long exploratory prompt: <i>'Analyze all routes, blueprints, and request handlers across the entire Flask codebase and summarize them in detail.'</i>",
                "Observe SSE tokens streaming in real time.",
                "Click the <b>Stop (Cancel)</b> button mid-generation.",
                "Show generation immediately terminates; VS Code remains completely responsive.",
                "Run <code>git status</code> in terminal to verify zero dirty writes touch the disk.",
            ],
            "voiceover": "Tokens stream live over Server-Sent Events. Clicking Stop instantly halts the turn via TrueForge's session cancellation endpoint. The editor never blocks, and disk state remains 100% clean.",
            "commands": [
                ('git status', 'nothing to commit, working tree clean (Zero silent or corrupted writes)'),
            ]
        },
        {
            "num": "Scene 5: Task C – Resilience & Transparent Auto Fallback",
            "time": "02:36 – 03:25 (Duration: 49s)",
            "visual": "Settings / Agent Panel showing model failover in action.",
            "actions": [
                "Point primary model to broken endpoint (or click <b>⚡ Task C (Failover)</b>).",
                "Repeat Task A instruction on <code>src/flask/helpers.py</code>.",
                "Observe: Primary model returns 401 Unauthorized / Unreachable Provider.",
                "Extension's <code>ModelFailoverManager</code> transparently intercepts failure.",
                "Non-blocking notification appears in status bar: <i>'Transparently switched to fallback model'</i>.",
                "Fallback model seamlessly completes the edit without user intervention or editor locks.",
            ],
            "voiceover": "Task C proves resilience. When our primary model encounters a broken endpoint or 401 error, our client intercepts it and transparently routes the turn to the backup model without throwing blocking modals or corrupting session state.",
            "commands": [
                ('git status', 'helpers.py modified (Only valid accepted diffs present, zero corrupted state)'),
            ]
        },
        {
            "num": "Scene 6: Conclusion & Repository Transparency",
            "time": "03:26 – 04:00 (Duration: 34s)",
            "visual": "Terminal running test suite, then quick display of GitHub repository and Write-up PDF.",
            "actions": [
                "Execute full test suite in terminal: <code>npm test</code> (all 5 suites pass).",
                "Execute backend test suite: <code>python tests/test_backend.py</code> (10/10 pass).",
                "Briefly display the 3-page Write-up PDF (<code>docs/TrueForge_Coding_Agent_Writeup.pdf</code>).",
                "Show public GitHub repository with MIT License and clean commit log.",
            ],
            "voiceover": "Every milestone is verified with automated test suites. Built strictly from scratch for Techfest 2026-27 IIT Bombay. Zero silent writes, model-agnostic, and 100% powered by TrueForge.",
            "commands": [
                ('npm test', '5/5 test suites passed (Client, Myers Diff, Task A, Task B, Task C)'),
                ('python tests/test_backend.py', '10/10 MCP tool tests passed successfully'),
            ]
        },
    ]

    for s in scenes:
        story.append(Paragraph(f"<b>{s['num']}</b> ({s['time']})", h2_style))

        # Scene Details Table
        scene_rows = [
            [Paragraph("<b>Visual Focus:</b>", bold_body), Paragraph(s['visual'], body_style)],
            [Paragraph("<b>Key Actions:</b>", bold_body), Paragraph("<br/>".join([f"• {a}" for a in s['actions']]), body_style)],
            [Paragraph("<b>Voiceover:</b>", bold_body), Paragraph(f"<i>\"{s['voiceover']}\"</i>", voiceover_style)],
        ]

        if s['commands']:
            cmd_lines = []
            for cmd, out in s['commands']:
                cmd_lines.append(f"<b>$</b> <code>{cmd}</code><br/>&nbsp;&nbsp;↳ <i>Output: {out}</i>")
            scene_rows.append([Paragraph("<b>Terminal:</b>", bold_body), Paragraph("<br/>".join(cmd_lines), code_style)])

        scene_table = Table(scene_rows, colWidths=[content_width * 0.18, content_width * 0.82])
        scene_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
            ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.HexColor("#e2e8f0")),
            ('TOPPADDING', (0, 0), (-1, -1), 2.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(scene_table)
        story.append(Spacer(1, 4))

    # Recording & Production Tips
    story.append(Spacer(1, 4))
    story.append(Paragraph("💡 Practical Recording & Submission Tips", h1_style))
    tips_data = [
        [Paragraph("<b>Resolution & FPS</b>", bold_body), Paragraph("Record at 1080p (1920x1080) at 30 or 60 fps. Set VS Code font size to 14–16px for crisp readability.", body_style)],
        [Paragraph("<b>Terminal Pre-fill</b>", bold_body), Paragraph("Pre-run terminal verification commands so you can recall them instantly using Up-Arrow + Enter.", body_style)],
        [Paragraph("<b>1-Click Demo Triggers</b>", bold_body), Paragraph("Use the webview header buttons (<b>⚡ Task A</b>, <b>⚡ Task B</b>, <b>⚡ Task C</b>) to trigger verified demo states flawlessly without typing latency.", body_style)],
        [Paragraph("<b>Submission Format</b>", bold_body), Paragraph("Upload the video as <b>Unlisted</b> on YouTube or open-permission Google Drive link before <b>20th Nov 2026, 23:59 IST</b>.", body_style)],
    ]
    tips_table = Table(tips_data, colWidths=[content_width * 0.25, content_width * 0.75])
    tips_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor("#edf2f7")),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(tips_table)

    doc.build(story, canvasmaker=NumberedCanvas)


if __name__ == "__main__":
    build_script_pdf()
