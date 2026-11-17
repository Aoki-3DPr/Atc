#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, m;
	cin >> n >> m;
	vector<pair<ll, ll>> a(m);
	vector<map<ll, ll>> mp(n + 1);
	map<ll, ll> mpt;
	for (ll i = 0; i < m; i++) {
		ll x, y;
		cin >> x >> y;
		a[i] = {x, y};
		mp[x][y]++;
		mpt[x]++;
	}
	ll ma_i = 0;
	ll ma_i2 = 0;
	vector<pair<ll, ll>> p;
	for (ll i = 1; i <= n; i++) {
		p.emplace_back(-mpt[i], i);
	}
	sort(p.begin(), p.end());
	ma_i = p[0].second;
	ma_i2 = p[1].second;
	for (ll i = 1; i <= n; i++) {
		ll ans = ma_i2;
		if (i != ma_i) {
			ans = ma_i;
		}
		ll ans_num = mpt[ans];
		for (auto j = mp[i].begin(); j != mp[i].end(); j++) {
			ll aa = mpt[j->first] + j->second;
			if (ans == 0 || ans_num < aa) {
				ans = j->first;
				ans_num = aa;
			} else if (ans_num == aa) {
				if (ans > j->first) {
					ans = j->first;
					ans_num = aa;
				}
			}
		}
		cout << ans << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
