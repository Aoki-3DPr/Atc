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
	priority_queue<pair<ll, pair<ll, ll>>, vector<pair<ll, pair<ll, ll>>>, greater<>> pq;
	pq.push({0, {1, 0}});
	ll rank = 0;
	ll old = 0;
	while (!pq.empty()) {
		pair<ll, pair<ll, ll>> p = pq.top(); pq.pop();
		ll len = p.first >> 32;
		ll i = p.second.first;
		ll num = p.second.second;
		if (used[i]) continue;
		used[i] = true;
		if (old != p.first) {
			old = p.first;
			rank++;
		}
		ans[i] = num;
		for (auto it = mp[i].begin(); it != mp[i].end(); it++) {
			if (used[it->first]) continue;
			pq.push({(rank << 32) + it->second, {it->first, (num * 10 + it->second) % mod}});
		}
	}
	for (ll i = 2; i <= n; i++) {
		cout << ans[i] << endl;
	}
	return 0;
}
