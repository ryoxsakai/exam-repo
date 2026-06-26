#!/usr/bin/env python3
"""東邦 2023 前期 大問3（幼児期健忘）を Worker API へ登録する。"""
import json
import urllib.request

API = "https://medical-exam-worker.ryoxsakai.workers.dev/api/exams"
UNI = "東邦"
YEAR = 2023
SCHEDULE = "前期"


def build_problem(*sections):
    lines = []
    for typ, text in sections:
        if typ != "問題":
            lines.append("{{" + typ + "}}")
        if text and text.strip():
            lines.append(text.strip())
    return "\n\n".join(lines)


PASSAGE = """[1] Most of us don't have any memories from the first three to four years of our lives — in fact, we tend to remember very little of life before the age of seven. And when we do try to think back to our earliest memories, it is often unclear whether they are the real thing or just recollections based on photos or stories told to us by others. The phenomenon, known as "childhood amnesia", has been puzzling psychologists for more than a century — and we still don't fully understand it. But research is starting to suggest an answer: Autobiographical memory might begin with the stories we tell each other.

[2] At first glance, it may seem that the reason we don't remember being babies is because infants and toddlers don't have a fully developed memory. But babies as young as six months can form both short-term memories that last for minutes, and long-term memories that last weeks, if not months. In one study, six-month-olds who learned how to press a lever to operate a toy train remembered how to perform this action for two to three weeks after they had last seen the toy. Preschoolers, on the other hand, can remember events that go years back. It's debatable whether long-term memories at this early age are truly autobiographical, though — that is, personally relevant events that occurred in a specific time and place.

[3] Of course, memory capabilities at these ages are not adult-like — they continue to __mature__ until adolescence. In fact, developmental changes in basic memory processes have been put forward as an explanation for childhood amnesia, and it's one of the best theories we've got so far. These basic processes involve several brain regions and include forming, maintaining and then later retrieving the memory. For example, the hippocampus, thought to be responsible for forming memories, continues developing until at least the age of seven. We know that the typical boundary for the offset of childhood amnesia — three and a half years — shifts with age. Children and teenagers have earlier memories than adults do. This suggests that the problem may be less with forming memories than with maintaining them.

[4] But this does not seem to be the whole story. Language also plays a role. From the ages of one to six, children progress from the one-word stage of speaking to becoming fluent in their native language(s), so there are major changes in their verbal ability that overlap with the childhood amnesia period. This includes using the past tense, memory-related words such as "remember" and "forget," and personal pronouns, a favorite being "mine."

[5] It is true to some extent that a child's ability to verbalize about an event at the time that it happened predicts how well they remember it months or years later. One lab group conducted this work by interviewing toddlers brought to accident and emergency departments for common childhood injuries. Toddlers over 26 months, who could talk about the event at the time, recalled it up to five years later — whereas those under 26 months, who could not talk about it, recalled little or nothing. This suggests that preverbal memories are lost if they are not translated into language.

[6] However, most research on the role of language focuses on a particular form of expression called narrative, and its social function. When parents reminisce with very young children about past events, they __implicitly__ teach them narrative skills — what kinds of events are important to remember and how to structure talking about them in a way that others can understand. [a] Unlike simply recounting information for factual purposes, reminiscing revolves around the social function of sharing experiences with others. [b] In this way, family stories maintain the memory's accessibility over time, and also increase the coherence of the narrative, including the chronology of events, their theme, and their degree of emotion. [c] Maori adults have the earliest childhood memories (age 2.5) of any society studied so far, thanks to Maori parents' highly elaborative style of telling family stories. [d]

[7] Reminiscing has different social functions in different cultures, which contribute to cultural variations in the quantity, quality, and timing of early autobiographical memories. Adults in cultures that value __autonomy__ (North America, Western Europe) tend to report earlier and more childhood memories than adults in cultures that value relatedness (Asia, Africa).

[8] This is predicted by cultural differences in parental reminiscing style. In cultures that promote more autonomous self-concepts, parental reminiscing focuses more on children's individual experiences, preferences, and feelings, and less on their relationships with others, social routines, and behavioral standards. For example, an American child might remember getting a gold star in preschool whereas a Chinese child might remember the class learning a particular song at preschool.

[9] While there are still things we don't understand about childhood amnesia, researchers are making progress. For example, there are more prospective __longitudinal__ studies that follow individuals from childhood into the future. This helps give accurate accounts of events, which is better than retrospectively asking teens or adults to remember past events which are not documented. Also, as neuroscience progresses, there will undoubtedly be more studies relating brain development to memory development. This should help us develop other measures of memory besides verbal reports.

[10] In the meantime, it's important to remember that, even if we can't explicitly remember specific events from when we were very young, __their accumulation__ nevertheless leaves lasting traces that influence our behavior. The first few years of life are paradoxically forgettable and yet powerful in shaping the adults that we become."""

SETSUMON = """{{問1}} According to paragraph 1, which of the following is true?
((a)) vivid memories of our childhood normally begin at three to four years old
((b)) childhood amnesia has been a subject of scientific study for the past few centuries
((c)) psychologists have discovered that autobiographical memory can be surprisingly accurate
((d)) we are often uncertain whether or not our early childhood memories are actual experiences

{{問2}} According to paragraph 2, which of the following is true?
((a)) six-month-old babies are able to remember what they did a few weeks ago
((b)) a young child's long-term memories are limited to personally relevant events
((c)) most preschoolers have difficulty recalling events that took place only a month ago
((d)) it is difficult to recall memories in infancy because infants' memory is not developed yet

{{問3}} The underlined word "mature" in paragraph 3 is closest in meaning to
((a)) complicate
((b)) develop
((c)) preoccupy
((d)) revitalize

{{問4}} According to paragraph 3, which of the following is true?
((a)) the hippocampus plays an important role in memory formation
((b)) it is normally harder to form correct memories than to properly maintain them
((c)) a particular brain region in which basic memory processes occur has recently been identified
((d)) childhood amnesia cannot be explained in terms of developmental changes in basic memory processes

{{問5}} According to paragraph 4, which of the following is true?
((a)) Children start using the word "forget" before learning to use "remember."
((b)) The use of past tense typically begins during the childhood amnesia period.
((c)) Non-verbal nature of infant memory is conspicuous during the ages of one to six.
((d)) Personal pronouns are one of the difficult categories of language use for children.

{{問6}} According to paragraph 5, which of the following is true?
((a)) children under two years of age recall events graphically as well as verbally
((b)) a child's linguistic ability can be seriously damaged by common childhood injuries
((c)) seven-year-old children could describe what happened to them when they were three
((d)) most toddlers brought to accident and emergency departments suffered from speech disorder

{{問7}} According to paragraph 5, one reason why childhood amnesia occurs is that
((a)) preverbal memories are lost when a baby reaches 26 months old
((b)) it is difficult for young children to translate one language into another
((c)) most of what very young children experience is hardly ever verbalized
((d)) most children start using fully developed language at around 26 months

{{問8}} The underlined word "implicitly" in paragraph 6 is closest in meaning to
((a)) immaturely
((b)) indirectly
((c)) inherently
((d)) invariably

{{問9}} Where would the following sentence best fit in paragraph 6?  Choose [a], [b], [c] or [d].
**More coherent stories are remembered better.**

{{問10}} According to paragraph 6, which of the following is true?
((a)) Maori adults consider it important to give detailed accounts of family stories.
((b)) The role which narrative plays in childhood memory has been underestimated.
((c)) Most reminiscing involves simple recounting of information for factual purposes.
((d)) Parents who try to teach their children narrative skills have better memories than those who don't.

{{問11}} The underlined word "autonomy" in paragraph 7 is closest in meaning to
((a)) altitude
((b)) education
((c)) disobedience
((d)) independence

{{問12}} According to paragraph 8, American parents are likely to talk to their children about
((a)) promoting autonomous community
((b)) what they achieved as a young child
((c)) social routines and behavioral standards
((d)) the significance of getting a gold star in preschool

{{問13}} The underlined word "longitudinal" in paragraph 9 is closest in meaning to
((a)) conducted over an extended period
((b)) done by using an organized procedure
((c)) referring to the natural features of a place
((d)) relating to the study of how disease spreads

{{問14}} In paragraph 10, the underlined phrase "their accumulation" refers to the accumulation of
((a)) gradually acquired long-term memories
((b)) a number of traumatic childhood memories
((c)) numerous things that young children experience
((d)) attempts to recollect what happened to them before

{{問15}} One problem with how childhood amnesia has been studied so far is that
((a)) it is getting harder to follow individuals from childhood into the future
((b)) remembering events from our childhood tends to influence our future behavior
((c)) it is difficult to conduct research relating brain development to memory development
((d)) researchers were often unable to attest the accuracy of a subject's childhood memories"""

ANSWERS = "{{問1}}((d))　{{問2}}((a))　{{問3}}((b))　{{問4}}((a))　{{問5}}((b))　{{問6}}((c))　{{問7}}((c))　{{問8}}((b))　{{問9}}((c))　{{問10}}((a))　{{問11}}((d))　{{問12}}((b))　{{問13}}((a))　{{問14}}((c))　{{問15}}((d))"

COMMENTARY = """{{問1}} 第1段第3文（And when we...）に、幼児期の記憶が実際の体験かどうか不明確であるとある。

{{問2}} 第2段第2〜3文（But babies as... seen the toy.）で、6カ月児が数週間前のことを記憶できると述べられている。

{{問3}} mature は「成熟する」の意で、develop が最も近い。同段に continues developing ともある。

{{問4}} 第3段第4文（For example, the hippocampus...）で、海馬が記憶の形成に関わると述べられている。

{{問5}} 第4段第3文（From the ages of one to six...）以下で、過去形の使用が幼児期健忘期に始まると述べられている。

{{問6}} 第5段第3文（Toddlers over 26 months...）で、26カ月以上の幼児が当時の出来事を話せれば数年後まで思い出せるとある。7歳児が3歳の時のことを説明できる可能性と整合する。

{{問7}} 第5段第3文以下で、言語化できない記憶は失われるとあり、幼児の経験の多くが言語化されないことが原因の一つと読める。

{{問8}} implicitly「黙示的に」と indirectly「間接的に」は対応関係にある。

{{問9}} 直前の the coherence of the narrative「語りの一貫性」を受けて、More coherent stories「一貫性の高い語り」とつながるため [c] が適切。

{{問10}} 第6段最終文（Maori adults have...）で、マオリの親の詳細な語り方が最も早い幼児期の記憶につながるとある。elaborative は detailed に近い。

{{問11}} autonomy「自律（性）」と independence「自立」が最も近い。

{{問12}} 第8段第2文（In cultures that promote...）以下より、個人の経験・達成（b）が適切。

{{問13}} longitudinal studies は長期にわたって追跡する研究の意で、(a) conducted over an extended period が正解。

{{問14}} their は直前の specific events from when we were very young「幼児期の特定の出来事」を受けるため、(c) が正解。

{{問15}} 第9段第2文（For example, there are more prospective longitudinal studies... are not documented.）より、記録のない過去の出来事を後から思い出させる研究では正確性を証明しにくかったことが問題の一つと読める。"""

ZENYAKU = """@@《幼児期健忘の解明に向けて》

[1] 我々の大半は、人生の最初の3〜4年間の記憶をもたない。実際、我々は7歳以前の生活についてほとんど記憶していない傾向がある。さらに、幼児期の記憶を思い返そうとしても、それが本当のことなのか、それとも写真や他者の我々に対する語りに基づく回想にすぎないのか、しばしば不鮮明だ。この現象は「幼児期健忘」として知られており、1世紀以上心理学者を悩ませ続け、我々はいまだに完全には理解していない。しかし研究が答えを示し始めている。自伝的記憶は、我々のお互いへの語りから始まっているのかもしれない。

[2] 一見すると、我々が幼児期を記憶していない理由は、乳幼児は記憶力が十分発達していないからだと思えるかもしれない。しかし生後6カ月の乳児でも、数分間続く短期記憶と、数カ月ではなく数週間続く長期記憶の両方を形成できる。ある研究では、おもちゃの電車を操作するレバーの押し方を学んだ6カ月児は、最後にそのおもちゃを見てから2〜3週間、そのやり方を記憶していた。一方、未就学児は何年も前の出来事を思い出せる。もっとも、このような時期の記憶が本当に自伝的なのか、すなわち特定の時と場所で起こった個人的に重要な出来事なのかどうかは議論の余地がある。

[3] もちろん、このような時期の記憶力は成人並みではなく、思春期まで成長し続ける。実際、基本的な記憶過程の発達的変化が幼児期健忘の説明として唱えられてきており、これは我々が今までに手にした中で最良の理論の一つである。この基本的な過程にはいくつかの脳の部位が関わっており、形成、維持、それにその後の再生が含まれる。例えば、海馬は記憶の形成を担当していると考えられているが、少なくとも7歳まで発達し続ける。我々が知るように、幼児期健忘消失の典型的境界線である3年半は、年齢とともに変わる。幼児やティーンエイジャーは、成人よりも早い記憶をもっている。これが示唆するように、問題は記憶の形成よりも、記憶の維持にあるのかもしれない。

[4] しかし、話はこれで全部ではなさそうだ。言語もまた役割を果たしている。1〜6歳にかけて、1語文の段階から母語を（場合によっては複数の母語を）流暢に話すまでに成長するため、幼児期健忘期と重なって言語能力に大きな変化が起こる。その中には、過去形、「思い出す」や「忘れる」などの記憶関連の単語、人称代名詞（お気に入りは "mine" の使用）がある。

[5] ある程度のところまで、出来事が起こった当時に幼児がそれについて言語化する能力は、数カ月後あるいは数年後の記憶の良さを予測する。ある研究グループは、幼児期によくある怪我で事故・救急外来に運ばれた幼児をインタビューすることでこの研究を行った。26カ月以上の幼児で、その時に出来事を話せた子は5年後までその出来事を思い出せたが、26カ月未満の幼児でその出来事について話せなかった子は、ほとんどあるいは全く何も思い出せなかった。これが示唆するように、言語習得以前の記憶は言語に変換されないと喪失する。

[6] しかし、言語の役割に関する研究の大半は、語りと呼ばれる特定の表現形式、並びにその社会的機能に焦点を当てている。親が幼児と一緒に過去の出来事を回想する時、親は黙示的に幼児に語りの技術を教えている。すなわち、どんな種類の出来事を記憶するのが重要か、他者が理解できるようにその出来事の話し方をどうやって組み立てるか、である。回想は、単に事実を明かす目的で情報を詳述するのとは違って、経験を他者と共有するという社会的機能を中心に展開する。このように、家族の語りは、経時的に記憶の想起しやすさを維持するとともに、出来事の時系列、テーマ、感情の度合いなどの語りの一貫性を高める。これまでに調査された社会の中で、マオリの成人は最も早い幼児期の記憶がある（2歳半）。この原因は、マオリの両親の家族の語り方が極めて入念だからだ。

[7] 回想は文化ごとに異なる社会的機能をもち、そのため初期の自伝的記憶の量・質・タイミングに文化的差異が生じる。自律性を重視する文化圏（北米、西欧）の成人は、関連性を重視する文化圏（アジア、アフリカ）の成人よりも、幼い頃の幼児期の記憶を多く報告する傾向にある。

[8] この予測因子は、親の回想様式の文化差だ。より自律的自己概念を奨励する文化圏では、親の回想は幼児個人の経験・好み・感情の方を重視し、他者との関係、社会的慣例、行動基準はあまり重視しない。例えば、アメリカの幼児は幼稚園で金色の星を手に入れた記憶があるかもしれず、他方で、中国の幼児は幼稚園の授業で特定の歌を習った記憶があるかもしれない。

[9] 幼児期健忘に関して我々が理解していないことはまだまだあるが、研究者たちは進歩を遂げている。例えば、幼児期から将来にわたって個人を追跡する前向き長期研究が増えている。これは出来事を正確に説明するのに役立ち、ティーンエイジャーや成人に、記録されていない過去の出来事を振り返って想起するように求めるよりも優れている。さらに、神経科学の進歩に伴い、脳の発達と記憶の発達を関連づける研究は間違いなく増えるだろう。これは、口頭報告以外の記憶の尺度の開発に役立つはずだ。

[10] その一方で覚えておくべきことだが、我々は幼児期の特定の出来事を明示的に記憶できなくても、それでもその累積は我々の行動に影響する持続的な痕跡を残している。逆説的だが、人生の最初の数年間は忘れられやすいのに、我々が成人になる上で大きな影響力をもつ。"""


def main():
    problem = build_problem(
        ("本文", "英文を読み、設問1〜15に最も適する答えをa.〜d.の中から一つ選べ。\n\n" + PASSAGE),
        ("設問", SETSUMON),
        ("解答", ANSWERS),
        ("解説", COMMENTARY),
        ("全訳", ZENYAKU),
    )
    body = {
        "universityName": UNI,
        "year": YEAR,
        "schedule": SCHEDULE,
        "questions": [{
            "questionNumber": 3,
            "category": "長文",
            "problemText": problem,
            "answerText": ANSWERS,
            "commentaryText": COMMENTARY,
        }],
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "exam-db-register/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        result = json.loads(res.read().decode())
    q = result["questions"][0]
    print("Registered:", UNI, YEAR, SCHEDULE, "大問", q["question_number"], "id=", q["id"])


if __name__ == "__main__":
    main()
