#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n;
	ll count = 0;
	while (cin >> n && n != 0) {
		count++;
		priority_queue<vector<long double>, vector<vector<long double>>, greater<>> q;
		for (ll i = 0; i < n; i++) {
			long double x, y ,r; cin >> x >> y >> r;
			q.push({y + r, x - r, x + r, -1});
			q.push({y - r, x - r, x + r, 1});
		}
		long double ans = 0;
		map<pair<long double, long double>, ll> s;
		while (!q.empty()) {
			auto chunk = q.top(); q.pop();
			if (chunk[3] == 1) {
				s[{chunk[1], chunk[2]}]++;
			} else {
				s[{chunk[1], chunk[2]}]--;
				if (s[{chunk[1], chunk[2]}] == 0) {
					s.erase({chunk[1], chunk[2]});
				}
			}
			while (!q.empty() && chunk[0] == q.top()[0]) {
				chunk = q.top(); q.pop();
				if (chunk[3] == 1) {
					s[{chunk[1], chunk[2]}]++;
				} else {
					s[{chunk[1], chunk[2]}]--;
					if (s[{chunk[1], chunk[2]}] == 0) {
						s.erase({chunk[1], chunk[2]});
					}
				}
			}
			long double len = 0;

			if (!q.empty() && !s.empty()) {
				long double r = s.begin()->first.first;
				long double l = s.begin()->first.first;
				for (auto i = s.begin(); i != s.end(); i++) {
					if (r <= i->first.first) {
						len += r - l;
						r = i->first.second;
						l = i->first.first;
					} else if (r >= i->first.second) {

					} else {
						r = i->first.second;
					}
				}
				len += r - l;
				ans += len * (q.top()[0] - chunk[0]);
			}
		}
		cout << count << ' ';
		printf("%.2Lf\n", ans);
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

