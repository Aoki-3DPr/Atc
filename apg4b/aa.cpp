#include <bits/stdc++.h>
#define ll long long
using namespace std;
int di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
int dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll MOD = 998244353;

vector<ll> fact_inv, inv, fact;
/*  init_nCk :二項係数のための前処理
	計算量:O(k)
*/
void init_nCk(int SIZE) {
	fact_inv.resize(SIZE + 5);
	inv.resize(SIZE + 5);
	fact.resize(SIZE + 5);
	fact_inv[0] = fact_inv[1] = 1;
	inv[1] = 1;
	fact[0] = fact[1] = 1;
	for (int i = 2; i < SIZE + 5; i++) {
		fact[i] = fact[i - 1] * i % MOD;
		inv[i] = MOD - inv[MOD % i] * (MOD / i) % MOD;
		fact_inv[i] = fact_inv[i - 1] * inv[i] % MOD;
	}
}
/* nCk :MODでの二項係数を求める(前処理 int_nCk が必要) */
ll nCk(ll n, ll k) {
	if (n < k || n < 0 || k < 0) return 0; // 安全対策
	ll ans = 1;
	for (ll i = n; i >= n - k + 1; i--) {
		// i が非常に大きい場合、そのまま掛けると long long でも
		// オーバーフローするため、必ず (i % MOD) を掛ける
		ans *= (i % MOD);
		ans %= MOD;
	}
	return ans * fact_inv[k] % MOD;
}

/* nCk :MODでの二項係数を求める(前処理 int_nCk が必要) */
ll nCk1(ll n, ll k) {
	if (n < k || n < 0 || k < 0) return 0; // 安全対策
	ll ans = fact[n] * fact_inv[n - k] % MOD;
	return ans * fact_inv[k] % MOD;
}

ll solve() {
	init_nCk(10e5);
	int n, k;
	while (cin >> n >> k && n != 0 && k != 0) {
		vector<int> s(n);
		for (int i = 0; i < n; i++) {
			int x; cin >> x;
			s[i] = x - 1;
		}
		vector<int> t(n);
 		for (int i = 0; i < n; i++) {
			int x; cin >> x;
 			t[i] = x - 1;
		}
		vector<int> s_index(n);
		for (int i = 0; i < n; i++) {
			s_index[i] = i;
		}
		sort(s_index.begin(), s_index.end(), [&s] (ll a, ll b) {return s[a] < s[b]; });
		ll buf = t[0];
		ll k_count = k - 1;
		ll n_count = 0;
		ll ans = 1;
		ll ma = buf;

		
		if (0 > k_count || ans == 0) {
			cout << 0 << endl;
		} else {
			for (int i = 1; i <= k_count; i++) {
				ans = (ans + nCk1(n_count, i)) % MOD;
			}
			cout << ans << endl;
		}
	}
	return 0;
}

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);
	solve();
	return 0;
}