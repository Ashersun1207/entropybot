import xml.etree.ElementTree as ET


def count_value(text):
    if not text.isascii() or not text.isdecimal():
        raise ValueError('invalid JUnit count')
    return int(text)


def summarize(element):
    counts = {'total':0,'passed':0,'failed':0,'skipped':0,'todo':0}
    failures = errors = 0
    for case in element.iter('testcase'):
        counts['total'] += 1
        terminals = [tag for tag in ['failure','error','skipped'] if case.find(tag) is not None]
        if len(terminals) > 1:
            raise ValueError('conflicting JUnit testcase states')
        if case.find('failure') is not None:
            counts['failed'] += 1; failures += 1
        elif case.find('error') is not None:
            counts['failed'] += 1; errors += 1
        elif case.find('skipped') is not None:
            skipped = case.find('skipped')
            kind = 'todo' if skipped.get('type','').lower()=='todo' else 'skipped'
            counts[kind] += 1
        else:
            counts['passed'] += 1
    return counts, failures, errors


def junit_counts(path):
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    root = ET.parse(path, parser=parser).getroot()
    if root.tag not in ['testsuites','testsuite']:
        raise ValueError('expected JUnit report')
    for element in root.iter():
        if element.tag not in ['testsuites','testsuite']:
            continue
        if any(child.tag not in ['testsuite','testcase','properties','system-out','system-err',ET.Comment] for child in element):
            raise ValueError('unsupported JUnit suite structure')
        counts, failures, errors = summarize(element)
        expected = {'tests':counts['total'],'failures':failures,'errors':errors,
                    'skipped':counts['skipped']+counts['todo'],'todo':counts['todo']}
        for key, value in expected.items():
            if key in element.attrib and count_value(element.attrib[key])!=value:
                raise ValueError('JUnit aggregate differs from testcase results')
    counts, _, _ = summarize(root)
    native = {'tests':counts['total'],'pass':counts['passed'],'fail':counts['failed'],
              'cancelled':0,'skipped':counts['skipped'],'todo':counts['todo']}
    seen = set()
    for child in root:
        if child.tag is ET.Comment:
            fields = (child.text or '').strip().split()
            if fields and fields[0] in native:
                if fields[0] in seen or len(fields)!=2 or count_value(fields[1])!=native[fields[0]]:
                    raise ValueError('Node JUnit summary differs from testcase results')
                seen.add(fields[0])
    return counts
