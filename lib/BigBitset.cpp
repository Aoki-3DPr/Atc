#pragma once
// bigbitset.cpp
// std::bitset の代わりに long long(uint64_t)配列で固定長ビット列を実現し、
// 文字列("0"/"1")からの構築、加算・減算、ビット演算、シフトを行うクラス。
//
// 最適化のポイント:
//  1. 加算・減算は __builtin_add_overflow / __builtin_sub_overflow を使い、
//     CPUのキャリーフラグ(ADC/SBB相当)を使う機械語列にコンパイルされるようにする
//  2. WORD=64(2のべき乗)なので、位置計算は割り算/剰余ではなく
//     シフト(>>6)とマスク(&63)で行う
//  3. 文字列コンストラクタは1ビットずつ set() を呼ぶのではなく、
//     ワード(64bit)単位でローカルレジスタに集約してからまとめて書き込む
//  4. 配列は alignas(64) でキャッシュライン境界に揃え、
//     AND/OR/XOR等の単純ループを自動ベクトル化しやすくする
//  5. すべてのメンバ関数はクラス内定義(暗黙 inline)、余分な分岐を避ける

#include <bits/stdc++.h>
using namespace std;

template <int SIZE>
struct BigBitset {
    static constexpr int WORD      = 64;
    static constexpr int WORD_SFT  = 6;              // 64 = 1<<6
    static constexpr int WORD_MASK = WORD - 1;        // 63
    static constexpr int LEN       = (SIZE + WORD - 1) >> WORD_SFT; // 必要ワード数

    alignas(64) unsigned long long bit[LEN];

    BigBitset() noexcept { memset(bit, 0, sizeof(bit)); }

    // ---------- 文字列からの構築 (std::bitset と同じ並び: 左端が上位ビット) ----------
    // 例: BigBitset<8> b("00001011"); // b は 11 を表す
    // s.size() > SIZE の場合は右側(下位) SIZE 文字のみを採用する
    explicit BigBitset(const string& s) noexcept {
        memset(bit, 0, sizeof(bit));
        const int n = (int)s.size();
        int idx = n - 1;              // s[idx] が bit0 (LSB) に対応
        int w = 0;
        while (idx >= 0 && w < LEN) {
            unsigned long long word = 0;
            const int bitsInWord = min(WORD, idx + 1);
            // ワード単位でローカル変数に集約してから1回だけ書き込む
            const char* base = s.data() + (idx - bitsInWord + 1);
            for (int b = 0; b < bitsInWord; b++) {
                // base[bitsInWord-1-b] が bit b に対応
                unsigned long long v = (base[bitsInWord - 1 - b] == '1');
                word |= (v << b);
            }
            bit[w] = word;
            idx -= bitsInWord;
            w++;
        }
    }

    static BigBitset fromULL(unsigned long long v) noexcept {
        BigBitset r;
        r.bit[0] = v;
        r.trim();
        return r;
    }

    // ---------- 基本操作 ----------
    inline void set(int i)   noexcept { bit[i >> WORD_SFT] |= (1ULL << (i & WORD_MASK)); }
    inline void reset(int i) noexcept { bit[i >> WORD_SFT] &= ~(1ULL << (i & WORD_MASK)); }
    inline void flip(int i)  noexcept { bit[i >> WORD_SFT] ^= (1ULL << (i & WORD_MASK)); }
    inline bool test(int i) const noexcept { return (bit[i >> WORD_SFT] >> (i & WORD_MASK)) & 1ULL; }

    void reset_all() noexcept { memset(bit, 0, sizeof(bit)); }

    // SIZE が64の倍数でない場合、余分な上位ビットを0にマスクする
    inline void trim() noexcept {
        constexpr int rem = SIZE & WORD_MASK;
        if constexpr (rem != 0) {
            constexpr unsigned long long mask = (1ULL << rem) - 1ULL;
            bit[LEN - 1] &= mask;
        }
    }

    int count() const noexcept {
        int c = 0;
        for (int i = 0; i < LEN; i++) c += __builtin_popcountll(bit[i]);
        return c;
    }

    bool any() const noexcept {
        for (int i = 0; i < LEN; i++) if (bit[i]) return true;
        return false;
    }
    bool none() const noexcept { return !any(); }

    // ---------- ビット演算 (単純な要素毎ループ -> 自動ベクトル化されやすい) ----------
    BigBitset operator&(const BigBitset& o) const noexcept {
        BigBitset r;
        for (int i = 0; i < LEN; i++) r.bit[i] = bit[i] & o.bit[i];
        return r;
    }
    BigBitset operator|(const BigBitset& o) const noexcept {
        BigBitset r;
        for (int i = 0; i < LEN; i++) r.bit[i] = bit[i] | o.bit[i];
        return r;
    }
    BigBitset operator^(const BigBitset& o) const noexcept {
        BigBitset r;
        for (int i = 0; i < LEN; i++) r.bit[i] = bit[i] ^ o.bit[i];
        return r;
    }
    BigBitset operator~() const noexcept {
        BigBitset r;
        for (int i = 0; i < LEN; i++) r.bit[i] = ~bit[i];
        r.trim();
        return r;
    }

    BigBitset& operator&=(const BigBitset& o) noexcept { for (int i=0;i<LEN;i++) bit[i]&=o.bit[i]; return *this; }
    BigBitset& operator|=(const BigBitset& o) noexcept { for (int i=0;i<LEN;i++) bit[i]|=o.bit[i]; return *this; }
    BigBitset& operator^=(const BigBitset& o) noexcept { for (int i=0;i<LEN;i++) bit[i]^=o.bit[i]; return *this; }

    // ---------- シフト ----------
    BigBitset operator<<(int s) const noexcept {
        BigBitset r;
        if (s <= 0) return *this;
        const int wordShift = s >> WORD_SFT, bitShift = s & WORD_MASK;
        for (int i = LEN - 1; i >= 0; i--) {
            unsigned long long v = 0;
            if (i - wordShift >= 0) v = bit[i - wordShift] << bitShift;
            if (bitShift != 0 && i - wordShift - 1 >= 0)
                v |= bit[i - wordShift - 1] >> (WORD - bitShift);
            r.bit[i] = v;
        }
        r.trim();
        return r;
    }
    BigBitset operator>>(int s) const noexcept {
        BigBitset r;
        if (s <= 0) return *this;
        const int wordShift = s >> WORD_SFT, bitShift = s & WORD_MASK;
        for (int i = 0; i < LEN; i++) {
            unsigned long long v = 0;
            if (i + wordShift < LEN) v = bit[i + wordShift] >> bitShift;
            if (bitShift != 0 && i + wordShift + 1 < LEN)
                v |= bit[i + wordShift + 1] << (WORD - bitShift);
            r.bit[i] = v;
        }
        return r;
    }

    // ---------- 加算・減算 (多倍長整数として mod 2^SIZE) ----------
    // __builtin_add_overflow / __builtin_sub_overflow は
    // x86-64 では ADC/SBB を使った命令列に最適化されることが多い
    BigBitset operator+(const BigBitset& o) const noexcept {
        BigBitset r;
        unsigned long long carry = 0;
        for (int i = 0; i < LEN; i++) {
            unsigned long long sum1;
            bool c1 = __builtin_add_overflow(bit[i], o.bit[i], &sum1);
            unsigned long long sum2;
            bool c2 = __builtin_add_overflow(sum1, carry, &sum2);
            r.bit[i] = sum2;
            carry = (unsigned long long)(c1 | c2);
        }
        r.trim();
        return r;
    }

    // this - o (this >= o を想定。負の場合は 2^SIZE を法とした結果)
    BigBitset operator-(const BigBitset& o) const noexcept {
        BigBitset r;
        unsigned long long borrow = 0;
        for (int i = 0; i < LEN; i++) {
            unsigned long long diff1;
            bool b1 = __builtin_sub_overflow(bit[i], o.bit[i], &diff1);
            unsigned long long diff2;
            bool b2 = __builtin_sub_overflow(diff1, borrow, &diff2);
            r.bit[i] = diff2;
            borrow = (unsigned long long)(b1 | b2);
        }
        r.trim();
        return r;
    }

    BigBitset& operator+=(const BigBitset& o) noexcept { *this = *this + o; return *this; }
    BigBitset& operator-=(const BigBitset& o) noexcept { *this = *this - o; return *this; }

    // 1加算・1減算(インクリメント/デクリメント): 桁上がり/借りが止まるまでの短絡ループ
    BigBitset& operator++() noexcept {
        for (int i = 0; i < LEN; i++) if (++bit[i] != 0) break;
        trim();
        return *this;
    }
    BigBitset& operator--() noexcept {
        for (int i = 0; i < LEN; i++) if (bit[i]-- != 0) break;
        trim();
        return *this;
    }

    // ---------- 比較 ----------
    bool operator==(const BigBitset& o) const noexcept {
        return memcmp(bit, o.bit, sizeof(bit)) == 0;
    }
    bool operator!=(const BigBitset& o) const noexcept { return !(*this == o); }

    bool operator<(const BigBitset& o) const noexcept {
        for (int i = LEN - 1; i >= 0; i--)
            if (bit[i] != o.bit[i]) return bit[i] < o.bit[i];
        return false;
    }
    bool operator>(const BigBitset& o)  const noexcept { return o < *this; }
    bool operator<=(const BigBitset& o) const noexcept { return !(o < *this); }
    bool operator>=(const BigBitset& o) const noexcept { return !(*this < o); }

    // ---------- 文字列化 ----------
    [[nodiscard]] string to_string() const {
        string s(SIZE, '0');
        for (int w = 0; w < LEN; w++) {
            unsigned long long v = bit[w];
            const int base = w << WORD_SFT;
            const int lim = min(WORD, SIZE - base);
            for (int b = 0; b < lim; b++) {
                if ((v >> b) & 1ULL) s[SIZE - 1 - (base + b)] = '1';
            }
        }
        return s;
    }
};


#ifdef BUILDING_LIB_STANDALONE
// ---------------- 動作確認・簡単なベンチマーク ----------------
int main() {
    const int N = 128;

    // 文字列コンストラクタ (bitset同様、左端がMSB)
    BigBitset<N> a("1110101101111001101000101010101"); // 上位ビットは自動的に0埋め
    BigBitset<N> b = BigBitset<N>::fromULL(987654321ULL);

    cout << "a (from string) = " << a.to_string() << "  (popcount=" << a.count() << ")\n";

    BigBitset<N> sum  = a + b;
    BigBitset<N> diff = (a < b) ? (b - a) : (a - b);
    cout << "a+b  = " << sum.to_string()  << "  (popcount=" << sum.count()  << ")\n";
    cout << "|a-b|= " << diff.to_string() << "  (popcount=" << diff.count() << ")\n";

    // 文字列からの丸トリップ確認
    string s = a.to_string();
    BigBitset<N> a2(s);
    cout << "roundtrip ok? " << boolalpha << (a == a2) << "\n";

    // ---- ベンチマーク: 1024bit の足し算を大量に繰り返す ----
    {
        const int BIG = 1024;
        BigBitset<BIG> x = BigBitset<BIG>::fromULL(123456789ULL);
        BigBitset<BIG> y = BigBitset<BIG>::fromULL(987654321ULL);
        const int ITER = 20'000'000;

        auto t0 = chrono::high_resolution_clock::now();
        BigBitset<BIG> acc = x;
        for (int i = 0; i < ITER; i++) acc += y;
        auto t1 = chrono::high_resolution_clock::now();

        double ms = chrono::duration<double, milli>(t1 - t0).count();
        cout << "1024bit add x" << ITER << " : " << ms << " ms"
             << "  (popcount(acc)=" << acc.count() << ")\n";
    }

    return 0;
}
#endif
