#include <bits/stdc++.h>
#define ll long long
using namespace std;

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll mod = 998244353;

int main() {
	ll n, m; cin >> n >> m;
	vector<vector<ll>> an(m, vector<ll>(3));
	vector<unordered_map<ll, ll>> mp(n + 1);
	for (ll i = 0; i < m; i++) {
		ll a, b, c; cin >> a >> b >> c;
		an[i] = {a, b, c};
		if (mp[a].contains(b)) {
			mp[a][b] = min(mp[a][b], c);
		} else {
			mp[a][b] = c;
		}
	}
	vector<ll> ans(n + 1);
	vector<bool> used(n + 1, false);

	map<ll, vector<pair<ll, string>>> mp_now;
	map<ll, vector<pair<ll, string>>> mp_next;
	mp_now[1].emplace_back(0, "");
	while (!mp_now.empty()) {
		while (!mp_now.empty()) {
			auto it = mp_now.begin();
			ll r = it->first, l = it->second[0].first;
			if (used[r]) {
				mp_now.erase(it);
				continue;
			}
			string s = it->second[0].second + (mp[l][r] == 0 ? "" : to_string(mp[l][r]));
			used[r] = true;
			ll buf = (ans[l] * 10 + mp[l][r]) % mod;
			for (ll i = 1; i < it->second.size(); i++) {
				l = it->second[i].first;
				if (s > it->second[i].second + to_string(mp[l][r])) {
					s = it->second[i].second + to_string(mp[l][r]);
					buf = (ans[l] * 10 + mp[l][r]) % mod;
				}
			}
			for (auto i = mp[r].begin(); i != mp[r].end(); i++) {
				ll next_r = i->first;
				if (used[next_r]) continue;
				mp_next[next_r].emplace_back(r, s);
			}
			ans[it->first] = buf;
			mp_now.erase(it);
		}
		mp_now = mp_next;
		mp_next.clear();
	}
	for (ll i = 2; i <= n; i++) {
		cout << ans[i] << endl;
	}
	return 0;
}
