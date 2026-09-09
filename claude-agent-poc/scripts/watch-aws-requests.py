#!/usr/bin/env python3
"""Read the two POC support cases; notify locally on changes. Never sends correspondence."""
import datetime
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.local' / 'aws-request-status.json'
AWS = '/opt/homebrew/bin/aws'
CASES = {
    '178889514500948': ('CloudFront', 'case-700002442063-muen-2026-1ba1d7821b11eb73'),
    '178889409700211': ('AgentCore', 'case-700002442063-muen-2026-6e71dc8b43457da5'),
}

def aws(*args):
    result = subprocess.run([AWS, *args, '--profile', 'ai', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)

def notify(message):
    # Pass notification text as an argument, never interpolate it into AppleScript.
    script = 'on run argv\n display notification (item 1 of argv) with title "AWS POC requests"\nend run'
    result = subprocess.run(['/usr/bin/osascript', '-e', script, message], capture_output=True, text=True, timeout=15)
    return result.returncode == 0

def main():
    os.umask(0o077)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    previous = json.loads(STATE.read_text()) if STATE.exists() else {}
    if previous.get('complete'):
        return
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    current = {'checkedAt': now, 'cases': {}, 'complete': False}
    changes = []
    try:
        response = aws('support', 'describe-cases', '--case-id-list', *[case[1] for case in CASES.values()], '--include-resolved-cases')
        for case in response.get('cases', []):
            display_id = case['displayId']
            label = CASES[display_id][0]
            communications = case.get('recentCommunications', {}).get('communications', [])
            latest = max((c.get('timeCreated', '') for c in communications), default='')
            item = {'name': label, 'status': case['status'], 'latestReplyAt': latest, 'recentCommunications': communications}
            current['cases'][display_id] = item
            old = previous.get('cases', {}).get(display_id)
            if old and (old.get('status') != item['status'] or old.get('latestReplyAt') != latest):
                changes.append(f'{label}: {item["status"]}' + (' (new reply)' if old.get('latestReplyAt') != latest else ''))
        quota = aws('service-quotas', 'get-requested-service-quota-change', '--request-id', 'd3451afc88624efb90bd4b29cb28a20cthEJCDRL')['RequestedQuota']
        current['quotaRequest'] = {key: quota.get(key) for key in ['Id', 'Status', 'DesiredValue', 'LastUpdated', 'CaseId']}
        old_quota = previous.get('quotaRequest', {})
        if old_quota and old_quota.get('Status') != quota['Status']:
            changes.append(f'AgentCore quota: {quota["Status"]}')
        current['complete'] = len(current['cases']) == 2 and all(c['status'] == 'resolved' for c in current['cases'].values()) and quota['Status'] in ['APPROVED', 'DENIED', 'CASE_CLOSED']
        if previous.get('error'):
            changes.append('Status checks are working again')
    except Exception as exc:
        current = {**previous, 'checkedAt': now, 'error': str(exc), 'complete': False}
        if current['error'] != previous.get('error'):
            changes.append('Status check failed; see the local status file')
    if changes:
        current['notificationSubmitted'] = notify('; '.join(changes))
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(current, indent=2) + '\n')
    temp.replace(STATE)
    print(json.dumps({'checkedAt': now, 'statuses': {c['name']: c['status'] for c in current.get('cases', {}).values()}, 'changes': changes, 'error': current.get('error')}), flush=True)

if __name__ == '__main__':
    main()
