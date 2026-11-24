#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll mod = 998244353;

ll solve() {
	string s, x, y; cin >> s >> x >> y;
	ll s_l = s.length(), x_l = x.length(), y_l = y.length();
	vector<ll> v(s_l + 1, 0);
	v[0] = 1;
	for (ll i = 0; i < s_l; i++) {
		if (v[i] == 0) continue;
		if (i + x_l <= s_l) {
			ll buf = 0;
			bool flag = true;
			for (ll j = 0; j < x_l; j++) {
				if (s[i + j] == '?' && '?' == x[j]) {
					buf++;
				} else if (s[i + j] != '?' && '?' != x[j] && s[i + j] != x[j]) {
					flag = false;
					break;
				}
			}
			if (flag) {
				v[i + x_l] += v[i] * (1 << buf) % mod;
			}
		}
		if (i + y_l == s_l) {
			ll buf = 0;
			bool flag = true;
			for (ll j = 0; j < y_l; j++) {
				if (s[i + j] == '?' && '?' == y[j]) {
					buf++;
				} else if (s[i + j] != '?' && '?' != y[j] && s[i + j] != y[j]) {
					flag = false;
					break;
				}
			}
			if (flag) {
				v[i + y_l] += v[i] * (1 << buf) % mod;
			}
		}
		if (i + y_l + x_l <= s_l) {
			ll buf = 0;
			bool flag = true;
			for (ll j = 0; j < y_l; j++) {
				if (s[i + j] == '?' && '?' == y[j]) {
					buf++;
				} else if (s[i + j] != '?' && '?' != y[j] && s[i + j] != y[j]) {
					flag = false;
					break;
				}
			}
			for (ll j = 0; j < x_l; j++) {
				if (s[i + j + y_l] == '?' && '?' == x[j]) {
					buf++;
				} else if (s[i + j + y_l] != '?' && '?' != x[j] && s[i + j + y_l] != x[j]) {
					flag = false;
					break;
				}
			}
			if (flag) {
				v[i + x_l + y_l] += v[i] * (1 << buf) % mod;
			}
		}
	}
	cout << v[s_l] % mod << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

