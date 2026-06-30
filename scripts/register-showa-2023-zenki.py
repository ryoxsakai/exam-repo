#!/usr/bin/env python3
import json
import urllib.request

API = "https://medical-exam-worker.ryoxsakai.workers.dev/api/exams"

# ── 大問1 ─────────────────────────────────────────────
q1_problem = """次の各文の( )の中に入れるのに最も適切な表現を1つずつ選び、記号で答えなさい。

{{問1}} Italians consume ( ) olive oil they think they do.
((A)) twice the amount of
((B)) the twice amount of
((C)) the amount of twice
((D)) of the twice amount

{{問2}} I, for one, think that Eddy is ( ) than unsociable.
((A)) shy
((B)) shier
((C)) more shy
((D)) more shier

{{問3}} ( ) another world war happen, nobody would survive.
((A)) Were
((B)) Should
((C)) If
((D)) Let

{{問4}} I ( ) Mt. Fuji five times if I climb it again this August.
((A)) have climbed
((B)) climb
((C)) will have climbed
((D)) will have been climbed

{{問5}} Those biscuits were delicious, but I'm afraid I ate ( ) too many.
((A)) one
((B)) it
((C)) them
((D)) those

{{問6}} I haven't seen you for a while. Let's get together and ( ) up over drinks.
((A)) talk
((B)) look
((C)) hang
((D)) catch

{{問7}} All the ( ) should be taken into consideration before drawing any conclusions.
((A)) progresses
((B)) informations
((C)) advices
((D)) arguments

{{問8}} We're concerned that our bosses ( ) one another.
((A)) quarrel
((B)) yell
((C)) hate
((D)) shout

{{問9}} This credit card can get you ( ) about anything you can think of.
((A)) entirely
((B)) just
((C)) exactly
((D)) even

{{問10}} My doctor ( ) deal with my psychological problems as well as my physical ones.
((A)) assisted
((B)) backed
((C)) helped
((D)) supported

{{問11}} My aunt ( ) me to begin playing the violin when I was little.
((A)) suggested
((B)) proposed
((C)) encouraged
((D)) demanded

{{問12}} Your young son is very good at writing music. In fact, I'd go as far as to say he's ( ).
((A)) Mozart
((B)) the Mozart
((C)) a Mozart
((D)) the Mozarts

{{問13}} Luke spoke to the building manager of his apartment to ( ) about having the light outside his front door fixed.
((A)) see
((B)) discuss
((C)) analyze
((D)) examine

{{問14}} Woman: This is for you, Rob.
Man: A present for me? Oh, ( )
((A)) you might as well.
((B)) you may have.
((C)) you shouldn't have.
((D)) you shall not.

{{問15}} Man: Shall we call it a day?
Woman: ( )
((A)) I'm talking to you!
((B)) I'll tell you what.
((C)) I'll say!
((D)) I'm speaking.

{{解答}}

{{問1}}((A))　{{問2}}((C))　{{問3}}((B))　{{問4}}((C))　{{問5}}((A))　{{問6}}((D))　{{問7}}((D))　{{問8}}((C))　{{問9}}((B))　{{問10}}((C))　{{問11}}((C))　{{問12}}((C))　{{問13}}((A))　{{問14}}((C))　{{問15}}((C))

{{解説}}

{{問1}} 倍数＋名詞の語順。「twice as much olive oil as ～」の形。
{{問2}} 同一人物の2つの性質を比較するときは -er ではなく more ～ than を用いる。
{{問3}} Should ＋主語＋動詞…の仮定法で if を省略すると語順が倒置する。
{{問4}} 未来完了形で「（その時までに）～したことがある」経験を表す。
{{問5}} one too many で「1つ余分に多く」。
{{問6}} catch up で近況を話し合う。
{{問7}} information と advice は不可算名詞。
{{問8}} hate の目的語として one another（相互）をとる。
{{問9}} just about で「ほとんど～」。
{{問10}} help do（原形不定詞）の形。
{{問11}} encourage O to do。
{{問12}} 固有名詞に不定冠詞を付けて「～のような人物」を表す。
{{問13}} see about ～ で「～を検討する」。
{{問14}} You shouldn't have. は「そこまでしなくても」の慣用表現。
{{問15}} I'll say! は強い同意「その通り！」。"""

q1_answer = "{{問1}}((A))　{{問2}}((C))　{{問3}}((B))　{{問4}}((C))　{{問5}}((A))　{{問6}}((D))　{{問7}}((D))　{{問8}}((C))　{{問9}}((B))　{{問10}}((C))　{{問11}}((C))　{{問12}}((C))　{{問13}}((A))　{{問14}}((C))　{{問15}}((C))"

q1_commentary = """{{問1}} 倍数＋名詞の語順。「twice as much olive oil as ～」の形。
{{問2}} 同一人物の2つの性質を比較するときは -er ではなく more ～ than を用いる。
{{問3}} Should ＋主語＋動詞…の仮定法で if を省略すると語順が倒置する。
{{問4}} 未来完了形で「（その時までに）～したことがある」経験を表す。
{{問5}} one too many で「1つ余分に多く」。
{{問6}} catch up で近況を話し合う。
{{問7}} information と advice は不可算名詞。
{{問8}} hate の目的語として one another（相互）をとる。
{{問9}} just about で「ほとんど～」。
{{問10}} help do（原形不定詞）の形。
{{問11}} encourage O to do。
{{問12}} 固有名詞に不定冠詞を付けて「～のような人物」を表す。
{{問13}} see about ～ で「～を検討する」。
{{問14}} You shouldn't have. は「そこまでしなくても」の慣用表現。
{{問15}} I'll say! は強い同意「その通り！」。"""

# ── 大問2 ─────────────────────────────────────────────
q2_problem = """2 下記の英文を読み、質問に答えなさい。

{{本文}}

[1] I learned about a lot of things in medical school, but mortality wasn't one of them. Although I was given a dry, ##leathery::堅い## corpse to dissect in my first term, that was solely a way to learn about human anatomy. Our textbooks had almost nothing on aging or frailty or dying. How the process unfolds, how people experience the end of their lives, and how it affects those around them seemed beside the point. The way we saw it, and the way our professors saw it, the purpose of medical schooling was to teach how to save lives, not how to tend to their [[I]]. [[--A--]]

[2] The one time I remember discussing mortality was during an hour we spent on ##The Death of Ivan Ilyich::『イワン・イリイチの死』（ロシアの作家トルストイ(1828-1910)による中編小説）##, Tolstoy's classic novella. It was in a weekly seminar called 'Patient-Doctor' — part of the school's effort to make us more rounded and [[II]] physicians. Some weeks we would practice our physical examination etiquette; other weeks we'd learn about the effects of socioeconomics and race [[ア]] health. And one afternoon we contemplated the suffering of Ivan Ilyich as he lay ill and worsening from some unnamed, untreatable disease. [[--B--]]

[3] In the story, Ivan Ilyich is forty-five years old, a midlevel Saint Petersburg ##magistrate::裁判官## whose life revolves mostly around petty concerns of social status. One day, he falls off a stepladder and [[III]] a pain in his side. Instead of abating, the pain gets worse, and he becomes unable to work. Formerly an "intelligent, polished, lively and agreeable man," he grows depressed and ##enfeebled::衰弱した##. Friends and colleagues avoid him. His wife calls in a series [[イ]] ever more expensive doctors. None of them can agree on a diagnosis, and the remedies they give him accomplish nothing. For Ilyich, it is all torture, and he simmers and rages at his situation.

[4] __"What tormented Ivan Ilyich most," Tolstoy writes, "was the deception, the lie, which for some reason they all accepted, that he was not dying but was simply ill, and he only need keep quiet and undergo a treatment and then something very good would result."__ Ivan Ilyich has flashes of hope that maybe things will turn around, but as he grows weaker and more ##emaciated::やせ衰えた## he knows what is happening. He lives in mounting anguish and fear of death. But death is not a subject that his doctors, friends, or family can ##countenance::是認する##. That is what causes him his most profound pain.

[5] "No one pitied him as he wished to be pitied," writes Tolstoy. "At certain moments after prolonged suffering he wished most of all (though he would have been ashamed to confess it) for someone to pity him as a sick child is pitied. He longed to be petted and comforted. He knew he was an important ##functionary::役人##, that he had a beard turning grey, and that therefore what he longed for was impossible, but still he longed for it."

[6] [[--C--]] As we medical students saw it, the failure of those around Ivan Ilyich to offer comfort or to acknowledge what is happening to him was a failure of [[IV]] and culture. The late-nineteenth-century Russia of Tolstoy's story seemed harsh and almost primitive to us. Just as we believed that modern medicine could probably have cured Ivan Ilyich [[ウ]] whatever disease he had, so too we took [[エ]] granted that honesty and kindness were basic responsibilities of a modern doctor. We were confident that in such a situation we would act [[V]].

[7] [[--D--]] While we knew how to sympathize, we weren't [[オ]] all certain we would know how to properly diagnose and treat. We paid our medical tuition to learn about the inner process of the body, the intricate mechanisms of its pathologies, and the vast ##trove::収集されたもの## of discoveries and technologies that have accumulated to stop them. We didn't imagine we needed to think about much else. So we put Ivan Ilyich out of our heads.

[8] Yet within a few years, when I came to experience surgical training and practice, I encountered patients forced to confront the realities of decline and mortality, and it did not take long __((unready/I/help/to/realize/was/to/them/how))__.

!!!!出典: Adapted from Atul Gawande 2014 Being Mortal — Medicine and What Matters in the End!!!!

{{設問}}

{{問1}} 空欄 [[I]] から [[V]] に入る表現として最も適切なものを各々の選択肢から1つ選んで記号で答えなさい。

空欄 [[I]]
((A)) quality
((B)) demise
((C)) expectancy
((D)) nature

空欄 [[II]]
((A)) humane
((B)) humanlike
((C)) humanoid
((D)) humankind

空欄 [[III]]
((A)) develops
((B)) grows
((C)) catches
((D)) generates

空欄 [[IV]]
((A)) politics
((B)) religion
((C)) character
((D)) economy

空欄 [[V]]
((A)) unknowingly
((B)) compassionately
((C)) undecidedly
((D)) consciously

{{問2}} 空欄 [[ア]] から [[オ]] に入る前置詞を書きなさい。

{{問3}} [4]の下線部を日本語に訳しなさい。

{{問4}} [8]の下線部の( )内の単語を並べ替えて、正しい英文を完成させなさい。但し、3番目にはhowが入るものとし、解答用紙には4番目、6番目、8番目に入る単語を書きなさい。

it did not take long [ 1 ] [ 2 ] [ 3 how ] [ 4 ] [ 5 ] [ 6 ] [ 7 ] [ 8 ] [ 9 ]

{{問5}} 下記の一文を挿入する位置として最も適切なものを[[--A--]]から[[--D--]]の4つのなかから選び、記号で答えなさい。

What worried us was knowledge.

{{解答}}

{{問1}}[[I]]((B))　[[II]]((A))　[[III]]((A))　[[IV]]((C))　[[V]]((B))
{{問2}}[[ア]] on　[[イ]] of　[[ウ]] of　[[エ]] for　[[オ]] at
{{問3}} 「イワン＝イリイチをもっとも苦しめたものは、自分は死につきつつあるわけではなくただ病気なだけで、安静にして治療を受けさえすれば、何かとてもいい結果が生じるだろうというごまかし、つまり嘘である。なぜかみんな、このごまかしを受け入れているのだ」
{{問4}} 4番目 unready、6番目 was、8番目 help（完成文: it did not take long to realize how unready I was to help them）
{{問5}}[[--D--]]

{{解説}}

{{問1}} demise「死」、humane「思いやりのある」、develops「（病気が）発症する」、character「人格」、compassionately「思いやりをもって」。
{{問2}} the effect of A on B／a series of ～／cure A of B／take for granted that ～／not ～ at all。
{{問3}} which は the deception, the lie を受け、that 以下は同格の名詞節。
{{問4}} (it did not take long) to realize how unready I was to help them の構文。
{{問5}} [7]末の医学知識への不安と対比する文なので [[--D--]] の直後が適切。

{{全訳}}

≪死について学ばない医学生≫

[1] 医学部では多くのことを学んだが、人が死ぬという事実はその中になかった。第1学期に乾いた堅い死体を与えられて解剖したが、それは人体の構造を学ぶ手段にすぎなかった。教科書には加齢や虚弱、死についてほとんど書かれていない。死がどう進行し、人々が人生の終わりをどう経験し、周囲にどう影響するかは、どうでもよいことのように思えた。私たちも教授たちも、医学教育の目的は命を救うことであり、死にゆく人の世話の仕方ではないと考えていた。

[2] 死について議論したのは、トルストイの中編小説『イワン・イリイチの死』を読んだときの1時間だけだった。それは「患者と医師」と呼ばれる週次セミナーで、よりバランスのとれた思いやりのある医師にするための試みの一環だった。ある週は身体診察の作法を練習し、別の週は社会経済や人種が健康に与える影響を学んだ。ある午後、不治の病で床につき悪化するイワン・イリイチの苦しみについて考えた。

[3] 物語のイワン・イリイチは45歳のサンクトペテルブルクの中級裁判官で、生活の大半は社会的地位への些細な関心に支配されていた。ある日、踏み台から落ちて脇腹に痛みを発症した。痛みは治まらず悪化し、働けなくなった。かつて「聡明で洗練され、活発で愛想のよい男」だった彼は、うつ状態になり衰弱した。友人や同僚は彼を避けた。妻は次々と高価な医者を呼んだが、診断も一致せず、治療も効かなかった。イリイチにとってすべてが苦痛であり、彼は怒りを募らせた。

[4] トルストイは書く。「イワン・イリイチをもっとも苦しめたものは、自分は死につきつつあるわけではなくただ病気なだけで、安静にして治療を受けさえすれば、何かとてもいい結果が生じるだろうというごまかし、つまり嘘である。なぜかみんな、このごまかしを受け入れているのだ」。一瞬の希望もあったが、弱り衰えてやせ細るうちに、何が起きているか分かった。死への恐怖と苦悩の中で生きた。しかし医師も友人も家族も死を認められなかった。それが最も深い苦しみだった。

[5] トルストイは書く。「彼が望むように憐れんでくれる者はいなかった」。長い苦痛のあと、（恥ずかしいと思いながらも）病気の子を哀れむように憐れんでほしいと願った。愛撫され慰められたかった。自分は重要な役人で白髪混じりの髭を生やしているから無理だと分かっていながら、それでも願った。

[6] 私たち医学生にとって、周囲の人々が慰めも認めもしなかったことは、人格と文化の失敗だった。19世紀後期のロシアは厳しく原始的に思えた。現代医学ならイワン・イリイチを治せただろうと信じる一方、誠実さと優しさは現代の医師の基本義務だと当然のことと考えた。そのような状況では思いやりをもって行動できると確信していた。

[7] 同情の仕方は分かっていたが、適切に診断し治療できるかは全く確信がなかった。医学の学費を払ったのは、体内の過程、病理の複雑な仕組み、それを止めるための発見と技術の宝庫を学ぶためだった。他に考える必要はないと思っていた。イワン・イリイチのことは頭から追い出した。

[8] しかし数年のうちに外科の研修と臨床を経験すると、衰えと死の現実に直面せざるを得ない患者に出会い、自分が彼らを助ける準備ができていないと気づくのにそう時間はかからなかった。"""

q2_answer = """{{問1}}[[I]]((B))　[[II]]((A))　[[III]]((A))　[[IV]]((C))　[[V]]((B))
{{問2}}[[ア]] on　[[イ]] of　[[ウ]] of　[[エ]] for　[[オ]] at
{{問3}} 「イワン＝イリイチをもっとも苦しめたものは、自分は死につきつつあるわけではなくただ病気なだけで、安静にして治療を受えさえすれば、何かとてもいい結果が生じるだろうというごまかし、つまり嘘である。なぜかみんな、このごまかしを受け入れているのだ」
{{問4}} 4番目 unready、6番目 was、8番目 help
{{問5}}[[--D--]]"""

q2_commentary = """{{問1}} demise「死」、humane「思いやりのある」、develops「（病気が）発症する」、character「人格」、compassionately「思いやりをもって」。
{{問2}} the effect of A on B／a series of ～／cure A of B／take for granted that ～／not ～ at all。
{{問3}} which は the deception, the lie を受け、that 以下は同格の名詞節。
{{問4}} (it did not take long) to realize how unready I was to help them の構文。
{{問5}} [7]末の医学知識への不安と対比する文なので [[--D--]] の直後が適切。"""

# ── 大問3 ─────────────────────────────────────────────
q3_problem = """3 下記の英文を読み、質問に答えなさい。

{{本文}}

[1] The value placed on creativity in modern times has led to a range of writers and thinkers trying to articulate what it is, how to stimulate it, and why it is important. It was while serving on a committee convened by the ##the Royal Society::王立協会（英国連邦を代表する科学アカデミー）## to assess what impact machine learning would likely have on society where I first encountered the theories of Margaret Boden.

[2] Boden is an original thinker who over the decades has managed to fuse many different disciplines: she is a philosopher, psychologist, physician, AI expert, and cognitive scientist. In her eighties now, with white hair flying like sparks and an ever-active brain, she enjoys engaging with the question of what these "tin cans," as she likes to call computers, might be capable of. To this __end__ ((I)) , she has identified three different types of human creativity.

[3] Exploratory creativity involves taking what is already there and exploring its outer edges, extending the limits of what is possible while remaining bound by the rules. Bach's music is the ##culmination::頂点## of a journey that baroque composers ##embarked on::乗り出す## to explore ##tonality::調性## by weaving together different voices. His preludes and fugues pushed the boundaries of what was possible before breaking the genre open and ##ushering in::先駆けとなる## the classical era of Mozart and Beethoven. Renoir and Pissarro reconceived how we could visualize nature and the world around us, but it was Claude Monet who really pushed the boundaries, painting his water lilies over and over until his flecks of color dissolved into a new form of abstraction.

[[--A--]]

[4] Boden believes that exploration __accounts for__ ((II)) 97 percent of human creativity. This is also the sort of creativity at which computers excel. Pushing a pattern or set of rules to an extreme is a perfect exercise for a computational mechanism that can perform many more calculations than the human brain can. But is it enough to yield a truly original creative act? When we hope for that, we generally imagine something more utterly unexpected.

[5] To understand Boden's second type, combinational creativity, think of an artist taking two completely different ##constructs::構造物## and finding a way to combine them. Often the rules governing one will suggest an interesting new framework for the other. Combination is a very powerful tool in the realm of mathematical creativity. The eventual solution of the ##Poincaré conjecture::ポアンカレ予想（フランスの数学者アンリ・ポアンカレが1904年の論文で提唱したトポロジーにおける予想）##, which describes the possible shapes of our universe, was arrived at by applying the very different tools used to understand flow over surfaces. In a leap of creative genius, ##Grigori Perelman::グリゴリー・ペレルマン（1966年生まれのロシアの数学者。ポアンカレ予想を証明した）## landed at the unexpected realization [[ア]] by knowing the way a liquid flows over a surface one could classify the possible surfaces that might exist.

[6] The arts have also benefited greatly from this form of ##cross-fertilization::相互作用##. Philip Glass took ideas he learned from working with Ravi Shankar and used them to create the additive process that is the heart of his minimalist music. Zaha Hadid combined her knowledge of architecture with her love of the pure forms of the Russian painter Kasimir Malevich to create a unique style of ##curvaceous::曲線美の## buildings. In cooking, creative master chefs have fused cuisines from opposite ends of the globe.

[[--B--]]

[7] It is Boden's third form of creativity that is the more mysterious and ##elusive::捕えどころのない##. What she calls transformational creativity is behind those rare moments that are complete game changers. Every art form has these gear shifts. Think of Picasso and ##cubism::キュビズム（20世紀初頭の前衛芸術運動）##. Schoenberg and ##atonality::無調性##. Joyce and modernism. They are phase changes, like when water suddenly goes from [[イ]] to gas or solid. This was the image ##Goethe::ヨハン・ヴォルフガング・フォン・ゲーテ（18世紀から19世紀にかけて多方面で活躍したドイツの詩人、小説家）## hit upon when he sought to describe how he was able to write ##The Sorrows of Young Werther::『若きウェルテルの悩み』（1774年に刊行されたゲーテによる書簡体形式の小説）##. He devoted two years to wrestling with how to tell the story, only [[ウ]] a startling event, a friend's suicide, to act as a sudden ##catalyst::触媒、刺激##. "At that instant," he recalled in ##Dichtung und Wahrheit::『詩と真実』（ゲーテによる自叙伝）##, "the plan of Werther was found; the whole shot together from all directions, and became a solid mass, as the water in a vase, which is just at the freezing point, is changed by the slightest ##concussion::衝撃## into ice."

[8] At first glance it would seem hard to program such a decisive shift, but consider that, quite often, these transformational moments hinge on changing the rules of the game, or dropping a long-held assumption. The ##square::平方## of a number is always positive. All molecules come in long lines, not chains. Music must be written inside a harmonic scale structure. Eyes go on either side of the nose. There is a meta rule for this type of creativity: start by dropping constraints and see what emerges. The creative act is to choose what to drop — or what new constraint to introduce — such that you end up with a new thing of value.

[9] If I were asked to identify a transformational moment in mathematics, the creation of the ##square root::平方根## of minus one, in the mid-sixteenth century, would be a good candidate. This was a number that many mathematicians believed did not exist. It was referred to as an ##imaginary number::虚数##. And yet its creation did not contradict previous mathematics. It turned out it had been a mistake to exclude it. Now consider, if that error had persisted to today: Would a computer __come up with__ ((III)) the concept of the square root of minus one if it were fed only data telling it that there is no number whose square could be [[エ]]? A truly creative act sometimes requires us to step outside the system and create a new reality. Can a complex algorithm do that?

[[--C--]]

[10] The emergence of the romantic movement in music is in many ways a catalog of rule-breaking. Instead of ##hewing to::固執する## close ##key signatures::調号## as earlier composers had done, ##upstarts::新参者## like Schubert chose to shift key in ways that deliberately defied expectations. Schumann left chords unresolved that Haydn or Mozart would have felt compelled to complete. Chopin composed dense moments of ##chromatic::半音階の## runs and challenged rhythmic expectations with his unusual accented passages and bending of tempos. The move from one musical era to another, from Medieval to Baroque to Classical to Romantic to Impressionist to Expressionist and beyond, is one long story of smashing the rules. It almost goes without saying that historical context plays an important role in allowing us to define something as new. Creativity is not an absolute but a relative activity. We are creative within our culture and frame of reference.

[[--D--]]

!!!!出典: Adapted from Marcus Du Sautoy 2019 The Creativity Code — Art and Innovation in the Age of AI!!!!

{{設問}}

{{問1}} [1]には文法上誤りのある単語が1語含まれている。その語をそのまま書き抜きなさい。

{{問2}} 下線部(I)から(III)の表現の本文中の意味に最も近いものを(A)から(D)のなかから選び、記号で答えなさい。

(I) end
((A)) cause
((B)) purpose
((C)) finale
((D)) conclusion

(II) accounts for
((A)) makes up
((B)) illustrates
((C)) defines
((D)) explains

(III) come up with
((A)) prove
((B)) conceive
((C)) feed
((D)) inspire

{{問3}} [[ア]]から[[エ]]の空欄に単語を1つずつ補いなさい。但し、[[ア]]にはアルファベット4文字、[[イ]]には6文字、[[ウ]]には3文字、[[エ]]には8文字から成る単語が入るものとする。

{{問4}} 下記の段落を挿入する位置として最も適切なものを[[--A--]]から[[--D--]]の4つのなかから選び、記号で答えなさい。

There are interesting hints that this sort of creativity might also be perfect for the world of AI. Take an algorithm that plays the blues and combine it with the music of Boulez and you will end up with a strange hybrid composition that might just create a new sound world.

{{問5}} 下記の(i)および(ii)について答えなさい。

(i) Margaret Bodenが分類した3つの創造性，即ち exploratory creativity（探索的創造性），combinational creativity（結合的創造性），transformational creativity（変形的創造性）の特徴を100字以内の日本語でまとめなさい。但し，句読点も字数に含むものとする。

(ii) 本文の内容に即して下記のそれぞれの人物が exploratory creativity を有すると考えられる場合はEを，combinational creativity を有すると考えられる場合はCを，transformational creativity を有すると考えられる場合はTを解答欄に書きなさい。また，本文からはこれら3つのいずれも有していない，あるいは有しているか判断できないと考えられる場合はNを解答欄に書きなさい。

(1) Claude Monet
(2) Mozart
(3) Poincaré
(4) Zaha Hadid
(5) Picasso
(6) Haydn

{{解答}}

{{問1}}where
{{問2}}(I)((B))　(II)((A))　(III)((B))
{{問3}}[[ア]] that　[[イ]] liquid　[[ウ]] for　[[エ]] negative
{{問4}}[[--B--]]
{{問5}}(i) 探索的創造性は既存の枠内で可能性を広げる。結合的創造性は異なる構造を結び付ける。変形的創造性はルールそのものを変える。(ii) (1)E (2)N (3)N (4)C (5)T (6)N

{{解説}}

{{問1}} It was ～ that … の強調構文なので where は誤り。正しくは that。
{{問2}} (I) end＝目的、(II) accounts for＝～を占める、(III) come up with＝～を思いつく。
{{問3}} [[ア]] realization that SV の同格 that。[[イ]] 水の三態の liquid。[[ウ]] only for A to do の結果用法。[[エ]] 負の数の square が negative。
{{問4}} 結合的創造性の文脈で「blues と Boulez を組み合わせる」例なので [[--B--]]。
{{問5}} Monet は境界を押し広げた探索的(E)。Zaha Hadid は建築と絵画を結合(C)。Picasso は変形的(T)の例。Mozart・Poincaré・Haydn は本文からは判断不能(N)。

{{全訳}}

≪3種類の創造性≫

[1] 現代社会では創造性への関心が高まり、それが何か、どう刺激し、なぜ重要かを論じる著述家や思想家が増えた。機械学習が社会に与える影響を評価する王立協会の委員会に参加していたとき、私は初めてマーガレット・ボーデンの理論に出会った。

[2] ボーデンは数十年にわたり哲学、心理学、医学、AI、認知科学を融合させてきた独創的な思想家である。80代になっても白髪を散らし活発な頭脳で、コンピュータを「ブリキ缶」と呼びながら、それらが何を成し得るかを論じ続けている。この目的のために、彼女は人間の創造性を3種類に分類した。

[3] 探索的創造性は、既にあるものの外縁を探り、規則の中で可能な限界を広げることである。バッハの音楽はバロック作曲家が調性を探求した旅の頂点であり、モーツァルトやベートーヴェンへと古典派を先駆けた。ルノワールやピサロが自然の見方を再構築したが、モネは睡蓮を何度も描き、色の点が抽象へと溶けていくまで境界を押し広げた。

[4] ボーデンは探索が人間の創造性の97パーセントを占めると考える。コンピュータが計算力で得意とする領域でもある。しかしそれだけで真に独創的な行為が生まれるかは別問題だ。

[5] 結合的創造性は、まったく異なる2つの構造物を組み合わせることである。数学ではポアンカレ予想の解決に、表面の流れを理解する道具が応用された。ペレルマンは液体の流れから可能な表面を分類できるという意外な気づきに至った。

[6] 芸術でも相互作用は大きい。フィリップ・グラスはラヴィ・シャンカールとの仕事から学んだ加法プロセスでミニマル音楽を作った。ザハ・ハディドは建築とマレーヴィチの純粋な形を結び合わせた。料理でも世界中の技法が融合している。

[7] 第三の変形的創造性は最も不可思議である。ピカソとキュビズム、シェーンベルクと無調性、ジョイスとモダニズムのように、水が液体から気体や固体へ変わる相転移のような革命である。ゲーテは友人の自殺という出来事が『若きウェルテルの悩み』の構想を一気に固めたと語った。

[8] こうした転換はしばしばルールの変更や長年の前提の放棄に依存する。「数の平方は常に正」「音楽は調性の中で書かれる」などの前提を捨てることから新しいものが生まれる。

[9] 数学における変形的瞬間として、16世紀半ばの虚数（マイナス1の平方根）の創造が挙げられる。多くの数学者はそれを存在しないと考えたが、除外することが誤りだった。今日も負の数の平方根しか与えられなければ、コンピュータは虚数を思いつけるだろうか。

[10] 音楽史のロマン主義の興隆は規則破りの連続である。シューベルトは調の転換を大胆に行い、シューマンはハイドンやモーツァルトなら解決した和音を未解決のまま残した。ショパンは半音階の密集した走句やリズムの工夫で期待を裏切った。創造性は絶対ではなく、文化と参照枠の中での相対的な活動である。"""

q3_answer = """{{問1}}where
{{問2}}(I)((B))　(II)((A))　(III)((B))
{{問3}}[[ア]] that　[[イ]] liquid　[[ウ]] for　[[エ]] negative
{{問4}}[[--B--]]
{{問5}}(i) 探索的創造性は既存の枠内で可能性を広げる。結合的創造性は異なる構造を結び付ける。変形的創造性はルールそのものを変える。(ii) (1)E (2)N (3)N (4)C (5)T (6)N"""

q3_commentary = """{{問1}} It was ～ that … の強調構文なので where は誤り。正しくは that。
{{問2}} (I) end＝目的、(II) accounts for＝～を占める、(III) come up with＝～を思いつく。
{{問3}} [[ア]] realization that SV の同格 that。[[イ]] 水の三態の liquid。[[ウ]] only for A to do の結果用法。[[エ]] 負の数の square が negative。
{{問4}} 結合的創造性の文脈で「blues と Boulez を組み合わせる」例なので [[--B--]]。
{{問5}} Monet は境界を押し広げた探索的(E)。Zaha Hadid は建築と絵画を結合(C)。Picasso は変形的(T)の例。Mozart・Poincaré・Haydn は本文からは判断不能(N)。"""

payload = {
    "universityName": "昭和医科",
    "year": 2023,
    "schedule": "前期",
    "questions": [
        {
            "questionNumber": 1,
            "category": "文法",
            "problemText": q1_problem,
            "answerText": q1_answer,
            "commentaryText": q1_commentary,
        },
        {
            "questionNumber": 2,
            "category": "長文",
            "problemText": q2_problem,
            "answerText": q2_answer,
            "commentaryText": q2_commentary,
        },
        {
            "questionNumber": 3,
            "category": "長文",
            "problemText": q3_problem,
            "answerText": q3_answer,
            "commentaryText": q3_commentary,
        },
    ],
}

with open("/tmp/showa2023_payload.json", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)

req = urllib.request.Request(
    API,
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8", "Origin": "https://exam.lrnr.jp"},
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read().decode())
    print(json.dumps(result, ensure_ascii=False, indent=2))
