import "./HomeIntro.css";

interface HomeIntroProps {
  vocabularyLabel?: string;
}

export function HomeIntro({ vocabularyLabel }: HomeIntroProps) {
  return (
    <section className="home-intro" aria-labelledby="home-intro-title">
      <div className="home-intro-copy">
        <div className="home-intro-brand">
          <span className="home-intro-mark" aria-hidden="true">读</span>
          <span>沉浸式小说背单词</span>
        </div>

        <h1 id="home-intro-title">看小说的时候，<br /><em>顺便把单词记住。</em></h1>
        <p>
          英文词会出现在原本的中文位置。点一下，就能看释义、音标和原句。
        </p>

        <div className="home-intro-features" aria-label="产品特点">
          <span>五套学习词库</span>
          <span>本地小说不上传</span>
          <span>点击英文查词</span>
        </div>

        {vocabularyLabel ? (
          <div className="home-intro-current">
            <span aria-hidden="true">✓</span>
            当前使用 {vocabularyLabel} 词库
          </div>
        ) : null}
      </div>

      <div className="home-intro-preview" aria-label="沉浸式阅读效果示例">
        <div className="home-preview-bar">
          <span className="home-preview-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>实际阅读效果</span>
        </div>
        <div className="home-preview-story">
          <span className="home-preview-chapter">第一章 · 陌生来电</span>
          <p>
            许葵把手机递给我。屏幕里那份被删掉的
            <span className="home-preview-word"> evidence</span>
            ，正好停在退款承诺出现的位置。
          </p>
          <div className="home-preview-definition">
            <div>
              <strong>evidence</strong>
              <span>/ˈevɪdəns/</span>
            </div>
            <b>证据；证明</b>
          </div>
        </div>
        <div className="home-preview-footer">
          <span>点击英文查看释义</span>
        </div>
      </div>
    </section>
  );
}
